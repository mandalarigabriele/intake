import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { NutritionConnectionPort } from "../src/mcp/connection.js";
import { authOptions, signIn } from "./helpers.js";

async function signedInApp(nutrition: NutritionConnectionPort) {
  const app = await buildApp({ auth: authOptions(), nutrition });
  const { cookie } = await signIn(app);
  return { app, headers: { cookie } };
}

function fakeConnection(overrides: Partial<NutritionConnectionPort> = {}): NutritionConnectionPort {
  return {
    isConnected: () => false,
    startAuthorization: async () => ({ status: "redirect", url: new URL("https://nutrition.example/authorize?x=1") }),
    finishAuthorization: async () => {},
    disconnect: async () => {},
    ...overrides,
  };
}

describe("Nutrition connection routes", () => {
  it("redirects to the authorization URL", async () => {
    const { app, headers } = await signedInApp(fakeConnection());
    const response = await app.inject({ method: "GET", url: "/connect/nutrition", headers });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://nutrition.example/authorize?x=1");
  });

  it("redirects home when already authorized", async () => {
    const { app, headers } = await signedInApp(fakeConnection({ startAuthorization: async () => ({ status: "authorized" }) }));
    const response = await app.inject({ method: "GET", url: "/connect/nutrition", headers });
    expect(response.headers.location).toBe("/?nutrition=connected");
  });

  it("finishes the authorization on callback", async () => {
    const finishAuthorization = vi.fn(async () => {});
    const { app, headers } = await signedInApp(fakeConnection({ finishAuthorization }));
    const response = await app.inject({ method: "GET", url: "/connect/nutrition/callback?code=abc&state=xyz", headers });
    expect(finishAuthorization).toHaveBeenCalledWith("abc", "xyz");
    expect(response.headers.location).toBe("/?nutrition=connected");
  });

  it("reports failures on callback without leaking details", async () => {
    const { app, headers } = await signedInApp(fakeConnection({
        finishAuthorization: async () => {
          throw new Error("state mismatch");
        },
      }));
    const denied = await app.inject({ method: "GET", url: "/connect/nutrition/callback?error=access_denied", headers });
    const failed = await app.inject({ method: "GET", url: "/connect/nutrition/callback?code=abc&state=bad", headers });
    expect(denied.headers.location).toBe("/?nutrition=error");
    expect(failed.headers.location).toBe("/?nutrition=error");
  });

  it("exposes the connection status and disconnects", async () => {
    const disconnect = vi.fn(async () => {});
    const { app, headers } = await signedInApp(fakeConnection({ isConnected: () => true, disconnect }));
    expect((await app.inject({ method: "GET", url: "/api/nutrition/status", headers })).json()).toEqual({ connected: true });
    expect((await app.inject({ method: "POST", url: "/api/nutrition/disconnect", headers })).json()).toEqual({ connected: false });
    expect(disconnect).toHaveBeenCalled();
  });

  it("requires the owner session", async () => {
    const app = await buildApp({ auth: authOptions(), nutrition: fakeConnection() });
    const browser = await app.inject({ method: "GET", url: "/connect/nutrition" });
    expect(browser.statusCode).toBe(302);
    expect(browser.headers.location).toBe("/auth/google?returnTo=%2Fconnect%2Fnutrition");
    expect((await app.inject({ method: "GET", url: "/api/nutrition/status" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/nutrition/disconnect" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

});
