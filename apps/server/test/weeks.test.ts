import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseNutritionSummary, parseWeightTrends } from "../src/parsers/summary.js";
import { mondayOf, type WeekRoutesOptions } from "../src/routes/weeks.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const summary = parseNutritionSummary(JSON.parse(fixture("nutrition-summary.json"))).value;

describe("summary parsers", () => {
  it("parses real nutrition summary structured content", () => {
    expect(summary.goals).toEqual({ kcal: 2200, protein: 135 });
    expect(summary.days).toEqual([
      { date: "2026-11-04", kcal: 790, protein: 49.4, mealCount: 5 },
      { date: "2026-11-05", kcal: 438, protein: 28.2, mealCount: 1 },
    ]);
  });

  it("parses weight trends, empty and with entries", () => {
    expect(parseWeightTrends(JSON.parse(fixture("weight-trends-empty.json"))).value).toEqual({ unit: "kg", target: null, entries: [] });
    const withEntries = parseWeightTrends({ unit: "kg", target: 72, days: [{ date: "2026-11-02", weight: 75.1 }, { date: "2026-10-26", weight: 75.6 }] });
    expect(withEntries.value.entries.map((e) => e.date)).toEqual(["2026-10-26", "2026-11-02"]);
  });

  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
  });
});

describe("week routes", () => {
  function fakeApi(overrides: Partial<WeekRoutesOptions["api"]> = {}): WeekRoutesOptions["api"] {
    return {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "15:00:00", utc: "" }),
      summary: async () => summary,
      weightTrends: async () => ({ unit: "kg", target: null, entries: [{ date: "2026-11-02", weight: 75.1 }] }),
      logWeight: async () => {},
      ...overrides,
    };
  }

  async function signedIn(api: WeekRoutesOptions["api"]) {
    const app = await buildApp({ auth: authOptions(), weekApi: api });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("returns the current week with empty days, averages over logged days and weight", async () => {
    const summaryFn = vi.fn(fakeApi().summary);
    const { app, headers } = await signedIn(fakeApi({ summary: summaryFn }));
    const week = (await app.inject({ method: "GET", url: "/api/weeks/current", headers })).json();
    expect(summaryFn).toHaveBeenCalledWith("2026-11-02", "2026-11-05");
    expect(week.start).toBe("2026-11-02");
    expect(week.end).toBe("2026-11-08");
    expect(week.days.map((d: { kcal: number | null }) => d.kcal)).toEqual([null, null, 790, 438, null, null, null]);
    expect(week.averages).toEqual({ kcal: 614, protein: 38.8, days: 2 });
    expect(week.weight.entries).toHaveLength(1);
  });

  it("does not query the summary for a future week", async () => {
    const summaryFn = vi.fn(fakeApi().summary);
    const { app, headers } = await signedIn(fakeApi({ summary: summaryFn }));
    const week = (await app.inject({ method: "GET", url: "/api/weeks/2026-11-12", headers })).json();
    expect(summaryFn).not.toHaveBeenCalled();
    expect(week.averages).toBeNull();
  });

  it("logs a weigh-in in kg and validates it", async () => {
    const logWeight = vi.fn(async () => {});
    const { app, headers } = await signedIn(fakeApi({ logWeight }));
    const ok = await app.inject({ method: "POST", url: "/api/weight", headers, payload: { weightKg: 74.8, idempotencyKey: "weigh-123456" } });
    expect(ok.statusCode).toBe(201);
    expect(logWeight).toHaveBeenCalledWith(74.8, "weigh-123456");
    const bad = await app.inject({ method: "POST", url: "/api/weight", headers, payload: { weightKg: 4, idempotencyKey: "weigh-123456" } });
    expect(bad.statusCode).toBe(400);
  });

  it("requires sign-in", async () => {
    const app = await buildApp({ auth: authOptions(), weekApi: fakeApi() });
    expect((await app.inject({ method: "GET", url: "/api/weeks/current" })).statusCode).toBe(401);
  });
});
