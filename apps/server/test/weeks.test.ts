import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseNutritionSummary, parseWeightTrends } from "../src/parsers/summary.js";
import { kcalShare, loggingStreak, mondayOf, type WeekRoutesOptions } from "../src/routes/weeks.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const summary = parseNutritionSummary(JSON.parse(fixture("nutrition-summary.json"))).value;

describe("summary parsers", () => {
  it("parses real nutrition summary structured content", () => {
    expect(summary.goals).toEqual({ kcal: 2200, protein: 135, fiber: 30, waterMl: 2500 });
    expect(summary.days).toEqual([
      { date: "2026-11-04", kcal: 790, protein: 49.4, carbs: 53.8, fat: 43.2, fiber: 5.8, waterMl: 0, mealCount: 5 },
      { date: "2026-11-05", kcal: 438, protein: 28.2, carbs: 68.9, fat: 7, fiber: 7.1, waterMl: 0, mealCount: 1 },
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
      ...overrides,
    };
  }

  async function signedIn(api: WeekRoutesOptions["api"]) {
    const app = await buildApp({ auth: authOptions(), weekApi: api });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("returns the current week with empty days, averages over logged days", async () => {
    const summaryFn = vi.fn(fakeApi().summary);
    const { app, headers } = await signedIn(fakeApi({ summary: summaryFn }));
    const week = (await app.inject({ method: "GET", url: "/api/weeks/current", headers })).json();
    // The week plus 28 days before it, for the logging streak
    expect(summaryFn).toHaveBeenCalledWith("2026-10-05", "2026-11-05");
    expect(week.start).toBe("2026-11-02");
    expect(week.end).toBe("2026-11-08");
    expect(week.days.map((d: { kcal: number | null }) => d.kcal)).toEqual([null, null, 790, 438, null, null, null]);
    // Today (Thursday) is still in progress: only Wednesday is a completed day
    // Macro calories 197.6 / 215.2 / 388.8 kcal: 24.65 / 26.85 / 48.5 %, rounded to add up to 100
    expect(week.averages).toEqual({ kcal: 790, protein: 49.4, fiber: 5.8, waterMl: 0, days: 1, kcalShare: { protein: 25, carbs: 27, fat: 48 } });
    expect(week.goals).toEqual({ kcal: 2200, protein: 135, fiber: 30, waterMl: 2500 });
    expect(week.consistency).toEqual({
      streak: ["2026-11-04", "2026-11-05"],
      logged: { days: ["2026-11-04", "2026-11-05"], total: 4 },
      protein: { hit: 0, total: 1, best: { date: "2026-11-04", value: 49.4 }, goal: 135 },
      fiber: { hit: 0, total: 1, best: { date: "2026-11-04", value: 5.8 }, goal: 30 },
      water: { hit: 0, total: 1, best: { date: "2026-11-04", value: 0 }, goal: 2500 },
      asPlanned: 0,
      skipped: 0,
    });
    expect(week).not.toHaveProperty("weight");
  });

  it("does not query the summary for a future week", async () => {
    const summaryFn = vi.fn(fakeApi().summary);
    const { app, headers } = await signedIn(fakeApi({ summary: summaryFn }));
    const week = (await app.inject({ method: "GET", url: "/api/weeks/2026-11-12", headers })).json();
    expect(summaryFn).not.toHaveBeenCalled();
    expect(week.averages).toBeNull();
  });

  it("requires sign-in", async () => {
    const app = await buildApp({ auth: authOptions(), weekApi: fakeApi() });
    expect((await app.inject({ method: "GET", url: "/api/weeks/current" })).statusCode).toBe(401);
  });
});

describe("kcalShare", () => {
  it("returns whole percentages adding up to 100, or null without macros", () => {
    expect(kcalShare(100, 100, 100 / 2.25)).toEqual({ protein: 34, carbs: 33, fat: 33 });
    expect(kcalShare(0, 0, 0)).toBeNull();
  });

  it("leaves days without recorded fiber out of the fiber average", async () => {
    const days = [
      { date: "2026-11-02", kcal: 2000, protein: 120, carbs: 200, fat: 70, fiber: 30, waterMl: 2000, mealCount: 4 },
      { date: "2026-11-03", kcal: 1800, protein: 100, carbs: 180, fat: 60, fiber: null, waterMl: 1000, mealCount: 3 },
    ];
    const api: WeekRoutesOptions["api"] = {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "15:00:00", utc: "" }),
      summary: async () => ({ goals: { kcal: 2200, protein: 135, fiber: 30, waterMl: 2500 }, days }),
    };
    const app = await buildApp({ auth: authOptions(), weekApi: api });
    const { cookie } = await signIn(app);
    const week = (await app.inject({ method: "GET", url: "/api/weeks/current", headers: { cookie } })).json();
    expect(week.averages.fiber).toBe(30);
    expect(week.averages.waterMl).toBe(1500);
    expect(week.consistency.fiber).toEqual({ hit: 1, total: 1, best: { date: "2026-11-02", value: 30 }, goal: 30 });
  });
});

describe("loggingStreak", () => {
  const day = (date: string, mealCount: number) => ({ date, kcal: 1, protein: 1, carbs: 0, fat: 0, fiber: null, waterMl: 0, mealCount });

  it("counts today once it has meals, otherwise ends yesterday", () => {
    const days = [day("2026-11-03", 2), day("2026-11-04", 1), day("2026-11-05", 3)];
    expect(loggingStreak(days, "2026-11-05")).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(loggingStreak(days, "2026-11-06")).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
  });

  it("stops at the first day without meals", () => {
    expect(loggingStreak([day("2026-11-02", 1), day("2026-11-04", 1)], "2026-11-04")).toEqual(["2026-11-04"]);
    expect(loggingStreak([day("2026-11-01", 1)], "2026-11-04")).toEqual([]);
  });
});
