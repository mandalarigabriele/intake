import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseMealPatterns } from "../src/parsers/mealPatterns.js";
import { parseMeals } from "../src/parsers/meals.js";
import type { InsightRoutesOptions } from "../src/routes/insight.js";
import { insightCandidates, pickInsight } from "../src/services/insight.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const patterns = parseMealPatterns(fixture("meal-patterns-7d.txt")).value;
const meals = parseMeals(fixture("meals-full-by-date.txt")).value.meals;
const summary = {
  goals: { kcal: 2200, protein: 135, waterMl: 2500 },
  days: [
    { date: "2026-11-04", kcal: 790, protein: 49.4, waterMl: 0, mealCount: 5 },
    { date: "2026-11-05", kcal: 2455, protein: 122, waterMl: 1750, mealCount: 6 },
    { date: "2026-11-06", kcal: 574, protein: 29.9, waterMl: 750, mealCount: 1 },
  ],
};

describe("insight", () => {
  it("builds sentences only from real figures", () => {
    const candidates = insightCandidates({ today: "2026-11-06", patterns, meals, summary, proteinGoal: 135 });
    expect(candidates[0]).toBe("Nei giorni in cui fai colazione arrivi a 76 g di proteine, contro 49 g quando la salti.");
    expect(candidates.some((c) => c.startsWith("In media un pasto ti porta"))).toBe(true);
    // No weekend day logged: no weekday/weekend comparison
    expect(candidates.some((c) => c.includes("weekend"))).toBe(false);
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
