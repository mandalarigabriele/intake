import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseMealPatterns } from "../src/parsers/mealPatterns.js";
import { parseMeals } from "../src/parsers/meals.js";
import type { InsightRoutesOptions } from "../src/routes/insight.js";
import { healthCandidates, insightCandidates, pickInsight } from "../src/services/insight.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const patterns = parseMealPatterns(fixture("meal-patterns-7d.txt")).value;
const meals = parseMeals(fixture("meals-full-by-date.txt")).value.meals;
const summary = {
  goals: { kcal: 2200, protein: 135, fiber: 30, waterMl: 2500 },
  days: [
    { date: "2026-11-04", kcal: 790, protein: 49.4, carbs: 0, fat: 0, fiber: null, waterMl: 0, mealCount: 5 },
    { date: "2026-11-05", kcal: 2455, protein: 122, carbs: 0, fat: 0, fiber: null, waterMl: 1750, mealCount: 6 },
    { date: "2026-11-06", kcal: 574, protein: 29.9, carbs: 0, fat: 0, fiber: null, waterMl: 750, mealCount: 1 },
  ],
};

/** 14 completed days before 2026-11-29: kcal 2400 on even days, 1900 on odd ones. */
function healthInput() {
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.parse("2026-11-15T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
    return { date, kcal: i % 2 === 0 ? 2400 : 1900, protein: 100, carbs: 0, fat: 0, fiber: null, waterMl: 0, mealCount: 4 };
  });
  const night = (date: string, asleepMinutes: number) => ({
    date, start: `${date}T00:00:00+01:00`, end: `${date}T07:00:00+01:00`, asleepMinutes, deepMinutes: 60, remMinutes: 90, coreMinutes: 200, awakeMinutes: 10, inBedMinutes: asleepMinutes + 10, source: "Fitbit",
  });
  return {
    today: "2026-11-29",
    patterns: { ...patterns, loggedDays: 7 },
    meals: [],
    summary: { goals: { kcal: 2200, protein: 135, fiber: 30, waterMl: 2500 }, days },
    proteinGoal: null,
    // Short nights (6 h) before the 2,400 kcal days, long ones (8 h) before the others
    health: {
      nights: days.map((d, i) => night(d.date, i % 2 === 0 ? 360 : 480)),
      steps: days.map((d, i) => ({ date: d.date, value: i % 2 === 0 ? 4000 : 10000 })),
      stepGoal: 8000,
    },
  };
}

describe("health insights", () => {
  it("compares kcal after short nights and on days at the step goal, over 28 days", () => {
    expect(healthCandidates(healthInput()).map((c) => c.text)).toEqual([
      "Dopo una notte sotto le 7 ore mangi in media 2.400 kcal, contro 1.900 kcal quando dormi di più.",
      "Nei giorni con almeno 8.000 passi mangi in media 1.900 kcal, contro 2.400 kcal negli altri.",
    ]);
  });

  it("needs 5 days in each group and a gap of at least 10%", () => {
    const input = healthInput();
    expect(healthCandidates({ ...input, health: { ...input.health, nights: input.health.nights.slice(0, 8) } })).toHaveLength(1);
    const close = input.summary.days.map((d) => ({ ...d, kcal: d.kcal === 2400 ? 2050 : 1900 }));
    expect(healthCandidates({ ...input, summary: { ...input.summary, days: close } })).toEqual([]);
    expect(healthCandidates({ ...input, health: undefined })).toEqual([]);
  });

  it("labels a Health sentence with its 28-day window", () => {
    const input = healthInput();
    const picked = pickInsight({ ...input, health: { ...input.health, steps: [] } });
    expect(picked).toEqual({ text: expect.stringContaining("notte sotto le 7 ore"), window: "Ultimi 28 giorni · 14 giorni registrati" });
  });
});

describe("insight", () => {
  it("builds sentences only from real figures", () => {
    const candidates = insightCandidates({ today: "2026-11-06", patterns, meals, summary, proteinGoal: 135 });
    expect(candidates[0]!.text).toBe("Nei giorni in cui fai colazione arrivi a 76 g di proteine, contro 49 g quando la salti.");
    expect(candidates.some((c) => c.text.startsWith("In media un pasto ti porta"))).toBe(true);
    // No weekend day logged: no weekday/weekend comparison
    expect(candidates.some((c) => c.text.includes("weekend"))).toBe(false);
  });

  it("picks the same sentence for the whole day and shows the window", () => {
    const input = { today: "2026-11-06", patterns, meals, summary, proteinGoal: 135 };
    const first = pickInsight(input);
    expect(pickInsight(input)).toEqual(first);
    expect(first?.window).toBe("Ultimi 7 giorni · 3 giorni registrati");
  });

  it("is hidden with fewer than 3 logged days", () => {
    expect(pickInsight({ today: "2026-11-06", patterns: { ...patterns, loggedDays: 2 }, meals, summary, proteinGoal: 135 })).toBeNull();
  });

  it("is served by GET /api/insight and cached for the day", async () => {
    const mealPatterns = vi.fn(async () => patterns);
    const api: InsightRoutesOptions["api"] = {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-06", localTime: "10:00:00", utc: "" }),
      mealPatterns,
      mealsByRange: async () => ({ timezone: null, meals }),
      summary: async () => summary,
      goals: async () => ({ kcal: 2200, protein: 135, carbs: 255, fat: 70, fiber: 30, waterMl: 2500, limits: { saturatedFat: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null }, targetWeight: null }),
    };
    const app = await buildApp({ auth: authOptions(), insightApi: api });
    const { cookie } = await signIn(app);
    const first = (await app.inject({ method: "GET", url: "/api/insight", headers: { cookie } })).json();
    await app.inject({ method: "GET", url: "/api/insight", headers: { cookie } });
    expect(first.insight.window).toBe("Ultimi 7 giorni · 3 giorni registrati");
    expect(mealPatterns).toHaveBeenCalledTimes(1);
    expect(mealPatterns).toHaveBeenCalledWith(7, "2026-11-06");
  });
});
