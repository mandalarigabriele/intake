import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { NutritionConnectionPort } from "../src/mcp/connection.js";

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
    const app = await buildApp({ nutrition: fakeConnection() });
    const response = await app.inject({ method: "GET", url: "/connect/nutrition" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://nutrition.example/authorize?x=1");
  });

  it("redirects home when already authorized", async () => {
    const app = await buildApp({ nutrition: fakeConnection({ startAuthorization: async () => ({ status: "authorized" }) }) });
    const response = await app.inject({ method: "GET", url: "/connect/nutrition" });
    expect(response.headers.location).toBe("/?nutrition=connected");
  });

  it("finishes the authorization on callback", async () => {
    const finishAuthorization = vi.fn(async () => {});
    const app = await buildApp({ nutrition: fakeConnection({ finishAuthorization }) });
    const response = await app.inject({ method: "GET", url: "/connect/nutrition/callback?code=abc&state=xyz" });
    expect(finishAuthorization).toHaveBeenCalledWith("abc", "xyz");
    expect(response.headers.location).toBe("/?nutrition=connected");
  });

  it("reports failures on callback without leaking details", async () => {
    const app = await buildApp({
      nutrition: fakeConnection({
        finishAuthorization: async () => {
          throw new Error("state mismatch");
        },
      }),
    });
    const denied = await app.inject({ method: "GET", url: "/connect/nutrition/callback?error=access_denied" });
    const failed = await app.inject({ method: "GET", url: "/connect/nutrition/callback?code=abc&state=bad" });
    expect(denied.headers.location).toBe("/?nutrition=error");
    expect(failed.headers.location).toBe("/?nutrition=error");
  });

  it("exposes the connection status and disconnects", async () => {
    const disconnect = vi.fn(async () => {});
    const app = await buildApp({ nutrition: fakeConnection({ isConnected: () => true, disconnect }) });
    expect((await app.inject({ method: "GET", url: "/api/nutrition/status" })).json()).toEqual({ connected: true });
    expect((await app.inject({ method: "POST", url: "/api/nutrition/disconnect" })).json()).toEqual({ connected: false });
    expect(disconnect).toHaveBeenCalled();
  });

  it("refuses owner-only routes in production until sign-in exists", async () => {
    const app = await buildApp({ nutrition: fakeConnection(), isProduction: true });
    expect((await app.inject({ method: "GET", url: "/connect/nutrition" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/nutrition/status" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });
});
