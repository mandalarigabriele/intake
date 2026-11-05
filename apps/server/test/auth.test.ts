import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { GoogleSignIn, type LoginTransaction } from "../src/auth/google.js";
import { safeReturnTo } from "../src/routes/auth.js";
import { OWNER, authOptions, cookieHeader, fakeGoogle, signIn } from "./helpers.js";

describe("sign-in routes", () => {
  it("redirects to Google and sets a short-lived, httpOnly login cookie", async () => {
    const app = await buildApp({ auth: authOptions() });
    const response = await app.inject({ method: "GET", url: "/auth/google" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    const login = response.cookies.find((c) => c.name === "intake_login");
    expect(login).toMatchObject({ httpOnly: true, sameSite: "Lax", maxAge: 600 });
  });

  it("signs the owner in and returns to the requested page", async () => {
    const app = await buildApp({ auth: authOptions() });
    const { callback, cookie } = await signIn(app, "/connect/nutrition");
    expect(callback.headers.location).toBe("/connect/nutrition");
    expect(cookie).not.toBe("");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json()).toEqual({ user: { email: OWNER, name: "Owner", picture: null } });
  });

  it("refuses any other Google account", async () => {
    const app = await buildApp({ auth: authOptions(fakeGoogle({ email: "someone@example.com" })) });
    const { callback, cookie } = await signIn(app);
    expect(callback.headers.location).toBe("/?signin=denied");
    expect(cookie).toBe("");
  });

  it("rejects a callback without the matching login cookie", async () => {
    const completeLogin = vi.fn();
    const app = await buildApp({ auth: authOptions({ ...fakeGoogle(), completeLogin }) });
    const response = await app.inject({ method: "GET", url: "/auth/callback?code=code-1&state=state-1" });
    expect(response.headers.location).toBe("/?signin=error");
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("rejects a callback with a different state", async () => {
    const app = await buildApp({ auth: authOptions() });
    const start = await app.inject({ method: "GET", url: "/auth/google" });
    const response = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-1&state=forged",
      headers: { cookie: cookieHeader(start) },
    });
    expect(response.headers.location).toBe("/?signin=error");
  });

  it("ignores a tampered session cookie", async () => {
    const app = await buildApp({ auth: authOptions() });
    const { cookie } = await signIn(app);
    const forged = Buffer.from(JSON.stringify({ email: OWNER, name: null, picture: null, exp: 9e9 })).toString("base64url");
    const tampered = cookie.replace(/=([^.]+)\./, `=${forged}.`);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: tampered } })).statusCode).toBe(401);
  });

  it("expires sessions after 30 days", async () => {
    let now = Date.parse("2026-11-05T10:00:00Z");
    const app = await buildApp({ auth: { ...authOptions(), now: () => now } });
    const { cookie } = await signIn(app);
    now += 31 * 24 * 3600 * 1000;
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("signs out", async () => {
    const app = await buildApp({ auth: authOptions() });
    const response = await app.inject({ method: "POST", url: "/auth/logout" });
    const cleared = response.cookies.find((c) => c.name === "intake_session");
    expect(cleared?.value).toBe("");
  });
});

describe("safeReturnTo", () => {
  it.each([
    ["/weight", "/weight"],
    ["/connect/nutrition", "/connect/nutrition"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/auth/callback", "/"],
    [undefined, "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe("GoogleSignIn", () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  const transaction: LoginTransaction = { state: "s", codeVerifier: "v", nonce: "n", returnTo: "/" };

  function idToken(claims: Record<string, unknown>) {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
  }

  const validClaims = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "123",
    email: "Owner@Example.com",
    email_verified: true,
    nonce: "n",
    exp: now / 1000 + 300,
    name: "Owner",
  };

  function signInWith(claims: Record<string, unknown>, status = 200) {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status }));
    const google = new GoogleSignIn({ clientId: "client-id", clientSecret: "secret", redirectUri: "http://localhost:3000/auth/callback", fetchFn, now: () => now });
    return { google, fetchFn };
  }

  it("builds an authorization URL with PKCE, state and nonce", () => {
    const { google } = signInWith(validClaims);
    const { url, transaction: tx } = google.createLogin("/");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(tx.state);
    expect(url.searchParams.get("nonce")).toBe(tx.nonce);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
  });

  it("exchanges the code with the verifier and returns the identity", async () => {
    const { google, fetchFn } = signInWith(validClaims);
    const identity = await google.completeLogin("code", transaction);
    expect(identity).toEqual({ sub: "123", email: "owner@example.com", name: "Owner", picture: null });
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("v");
  });

  it.each([
    ["issuer", { iss: "https://evil.example" }],
    ["audience", { aud: "other-client" }],
    ["expiry", { exp: now / 1000 - 1 }],
    ["nonce", { nonce: "other" }],
    ["unverified email", { email_verified: false }],
  ])("rejects a token with a wrong %s", async (_name, override) => {
    const { google } = signInWith({ ...validClaims, ...override });
    await expect(google.completeLogin("code", transaction)).rejects.toThrow();
  });

  it("fails when Google rejects the code", async () => {
    const { google } = signInWith(validClaims, 400);
    await expect(google.completeLogin("code", transaction)).rejects.toThrow("status 400");
  });
});
