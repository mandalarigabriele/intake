import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseGoals } from "../src/parsers/goals.js";
import type { ProfileRoutesOptions } from "../src/routes/profile.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const goals = parseGoals(fixture("goals.txt")).value;

describe("profile routes", () => {
  function fakeApi(overrides: Partial<ProfileRoutesOptions["api"]> = {}): ProfileRoutesOptions["api"] {
    return {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-13", localTime: "09:00:00", utc: "" }),
      goals: async () => goals,
      weightTrends: async () => ({ unit: "kg", target: null, entries: [{ date: "2026-11-06", weight: 75.4 }, { date: "2026-11-13", weight: 75 }] }),
      logWeight: async () => {},
      setGoals: async () => {},
      setTimezone: async () => {},
      ...overrides,
    };
  }

  async function signedIn(api: ProfileRoutesOptions["api"], hevyConfigured = true) {
    const app = await buildApp({ auth: authOptions(), profile: { api, hevyConfigured } });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("returns weigh-ins over 90 days up to today, the daily goals and the Hevy setup", async () => {
    const weightTrends = vi.fn(fakeApi().weightTrends);
    const { app, headers } = await signedIn(fakeApi({ weightTrends }));
    const profile = (await app.inject({ method: "GET", url: "/api/profile", headers })).json();
    expect(weightTrends).toHaveBeenCalledWith(90, "2026-11-13");
    expect(profile).toEqual({
      today: "2026-11-13",
      weight: { unit: "kg", target: null, entries: [{ date: "2026-11-06", weight: 75.4 }, { date: "2026-11-13", weight: 75 }] },
      goals: { kcal: 2200, protein: 135, carbs: 255, fat: 70, fiber: 30, waterMl: 2500 },
      hevyConfigured: true,
      timezone: "Europe/Rome",
    });
  });

  it("sets the Nutrition timezone to a valid IANA name only", async () => {
    const setTimezone = vi.fn(async () => {});
    const { app, headers } = await signedIn(fakeApi({ setTimezone }));
    const ok = await app.inject({ method: "POST", url: "/api/timezone", headers, payload: { timezone: "Europe/Rome" } });
    expect(ok.json()).toEqual({ timezone: "Europe/Rome" });
    expect(setTimezone).toHaveBeenCalledWith("Europe/Rome");
    expect((await app.inject({ method: "POST", url: "/api/timezone", headers, payload: { timezone: "UTC" } })).statusCode).toBe(200);
    // Valid names that a runtime's list may not show yet are accepted (Asia/Kolkata was refused before)
    for (const timezone of ["Asia/Kolkata", "Europe/Kyiv", "America/Argentina/Buenos_Aires", "Etc/GMT+1"]) {
      expect((await app.inject({ method: "POST", url: "/api/timezone", headers, payload: { timezone } })).statusCode).toBe(200);
    }
    for (const timezone of ["Mars/Olympus", "", 42, "+01:00", "GMT", "europe/rome"]) {
      expect((await app.inject({ method: "POST", url: "/api/timezone", headers, payload: { timezone } })).statusCode).toBe(400);
    }
    expect(setTimezone).toHaveBeenCalledTimes(6);
  });

  it("changes only the goals sent, clears with null and refuses impossible values", async () => {
    const setGoals = vi.fn(async () => {});
    const { app, headers } = await signedIn(fakeApi({ setGoals }));
    const ok = await app.inject({ method: "PUT", url: "/api/goals", headers, payload: { kcal: 2100, protein: 150, fiber: null, targetWeight: 72.5, weightUnit: "kg" } });
    expect(ok.statusCode).toBe(200);
    expect(setGoals).toHaveBeenCalledWith({ kcal: 2100, protein: 150, fiber: null, targetWeight: 72.5, weightUnit: "kg" });
    expect((await app.inject({ method: "PUT", url: "/api/goals", headers, payload: { kcal: -5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/goals", headers, payload: { sugar: 30 } })).statusCode).toBe(400);
    // The target weight range follows the unit: 300 lb is fine, 500 kg is not
    expect((await app.inject({ method: "PUT", url: "/api/goals", headers, payload: { targetWeight: 500, weightUnit: "kg" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/goals", headers, payload: { targetWeight: 300, weightUnit: "lb" } })).statusCode).toBe(200);
    expect(setGoals).toHaveBeenLastCalledWith({ targetWeight: 300, weightUnit: "lb" });
    expect(setGoals).toHaveBeenCalledTimes(2);
  });

  it("logs a weigh-in in kg and validates it", async () => {
    const logWeight = vi.fn(async () => {});
    const { app, headers } = await signedIn(fakeApi({ logWeight }), false);
    const ok = await app.inject({ method: "POST", url: "/api/weight", headers, payload: { weightKg: 74.8, idempotencyKey: "weigh-123456" } });
    expect(ok.statusCode).toBe(201);
    expect(logWeight).toHaveBeenCalledWith(74.8, "weigh-123456");
    const bad = await app.inject({ method: "POST", url: "/api/weight", headers, payload: { weightKg: 4, idempotencyKey: "weigh-123456" } });
    expect(bad.statusCode).toBe(400);
  });

  it("requires sign-in", async () => {
    const app = await buildApp({ auth: authOptions(), profile: { api: fakeApi(), hevyConfigured: false } });
    expect((await app.inject({ method: "GET", url: "/api/profile" })).statusCode).toBe(401);
  });
});
