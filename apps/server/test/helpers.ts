import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AuthOptions } from "../src/app.js";
import type { GoogleIdentity, GoogleSignInPort, LoginTransaction } from "../src/auth/google.js";

export const OWNER = "owner@example.com";

/** Google sign-in stand-in: a fixed state, and a configurable identity returned for any code. */
export function fakeGoogle(identity: Partial<GoogleIdentity> = {}): GoogleSignInPort & { lastTransaction?: LoginTransaction } {
  const fake: GoogleSignInPort & { lastTransaction?: LoginTransaction } = {
    createLogin(returnTo) {
      const transaction = { state: "state-1", codeVerifier: "verifier", nonce: "nonce", returnTo };
      fake.lastTransaction = transaction;
      return { url: new URL("https://accounts.google.com/o/oauth2/v2/auth?state=state-1"), transaction };
    },
    async completeLogin() {
      return { sub: "1", email: OWNER, name: "Owner", picture: null, ...identity };
    },
  };
  return fake;
}

export function authOptions(google: GoogleSignInPort = fakeGoogle()): AuthOptions {
  return { google, ownerEmail: OWNER, sessionSecret: "s".repeat(32), secureCookies: false };
}

/** Cookie header made from the Set-Cookie headers of a response. */
export function cookieHeader(response: LightMyRequestResponse): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** Runs the sign-in flow and returns the resulting Cookie header and callback response. */
export async function signIn(app: FastifyInstance, returnTo = "/") {
  const start = await app.inject({ method: "GET", url: `/auth/google?returnTo=${encodeURIComponent(returnTo)}` });
  const callback = await app.inject({
    method: "GET",
    url: "/auth/callback?code=code-1&state=state-1",
    headers: { cookie: cookieHeader(start) },
  });
  const session = callback.cookies.find((cookie) => cookie.name === "intake_session" && cookie.value);
  return { callback, cookie: session ? `intake_session=${session.value}` : "" };
}
