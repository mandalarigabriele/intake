import { readFileSync } from "node:fs";
import { mealPlanSchema } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { PlanGenerationStore } from "../src/db/planGenerationStore.js";
import { PlanStore } from "../src/db/planStore.js";
import { parseGoalProgress } from "../src/parsers/goalProgress.js";
import { parseMeals } from "../src/parsers/meals.js";
import { blockedBy } from "../src/routes/features.js";
import { RecognitionError } from "../src/services/mealRecognition.js";
import { getDayView } from "../src/services/dayView.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const plan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));
const clock = { timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "09:30:00", utc: "2026-11-05T08:30:00Z" };
const answer = {
  description: "Orata e patate",
  reason: "Leggera e ricca di proteine, adatta a quello che resta della giornata.",
  foods: [
    { name: "Orata", quantity: 200, unit: "g", kcal: 220, protein: 40, carbs: 0, fat: 6, fiber: 0, sugar: 0, addedSugar: 1 },
    { name: "Patate", quantity: 200, unit: "g", kcal: 150, protein: 4, carbs: 34, fat: 0, fiber: 4, sugar: 2, addedSugar: 0 },
  ],
};

describe("day alternative route", () => {
  function setup(suggestForDay?: (...args: any[]) => Promise<typeof answer>) {
    const plans = new PlanStore(openDatabase(":memory:"));
    plans.add(plan);
    const progress = parseGoalProgress(JSON.parse(fixture("goal-progress.json"))).value;
    const api = {
      clock: async () => clock,
      goalProgress: async () => progress,
      mealsByDate: async () => parseMeals(fixture("meals-full-today.txt")).value,
      summary: vi.fn(async () => ({ goals: { kcal: 2100, protein: 140, fiber: 30, waterMl: 2500 }, days: [{ date: "2026-11-02", kcal: 1900, protein: 120, carbs: 200, fat: 60, fiber: 25, waterMl: 2000, mealCount: 4 }, { date: "2026-11-03", kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: null, waterMl: 0, mealCount: 0 }, { date: "2026-11-04", kcal: 2100, protein: 140, carbs: 230, fat: 70, fiber: 30, waterMl: 2500, mealCount: 5 }] })),
    };
    const generator = suggestForDay ? { suggestForDay: vi.fn(suggestForDay) } : undefined;
    return { plans, api, generator };
  }

  async function signedIn(deps: ReturnType<typeof setup>) {
    const app = await buildApp({ auth: authOptions(), dayAlternative: { api: deps.api, plans: deps.plans, store: new PlanGenerationStore(openDatabase(":memory:")), generator: deps.generator as never } });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  async function openIndex(deps: ReturnType<typeof setup>) {
    const view = await getDayView({ ...deps.api, addWater: async () => {} } as never, deps.plans, "today");
    return view.planned.find((p) => p.status === "todo" || p.status === "planned")!;
  }

  it("proposes a dish sized on what is left of the day, with the hint, the week so far and the other meals still to eat", async () => {
    const deps = setup(async () => answer);
    const { app, headers } = await signedIn(deps);
    const entry = await openIndex(deps);
    const response = await app.inject({ method: "POST", url: "/api/days/today/alternative", headers, payload: { index: entry.index, note: "ho orata e patate" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ planIndex: entry.index, title: entry.title, time: entry.time, type: entry.type, description: "Orata e patate" });
    expect(body.items).toHaveLength(2);
    // Added sugar never above sugar
    expect(body.items[0].nutrients).toMatchObject({ kcal: 220, sugar: 0, addedSugar: 0 });
    expect(body.budget.kcal).toBeGreaterThanOrEqual(150);
    const sent = deps.generator!.suggestForDay.mock.calls[0]![0];
    expect(sent.note).toBe("ho orata e patate");
    expect(sent.meal).toMatchObject({ title: entry.title, time: entry.time });
    expect(sent.week).toEqual({ days: 2, avgKcal: 2000, avgProtein: 130 });
    // The meal itself is not counted among the others still to eat (two snacks share a title, so count them)
    const view = await getDayView({ ...deps.api, addWater: async () => {} } as never, deps.plans, "today");
    expect(sent.otherMealsLeft).toHaveLength(view.planned.filter((p) => p.status === "todo" || p.status === "planned").length - 1);
    expect(sent.budget).toEqual(body.budget);
  });

  it("refuses an unknown or already eaten meal, a bad body, and answers 503 without a key and 402 without credit", async () => {
    const deps = setup(async () => answer);
    const { app, headers } = await signedIn(deps);
    const post = (payload: Record<string, unknown>, h = headers) => app.inject({ method: "POST", url: "/api/days/today/alternative", headers: h, payload });
    expect((await post({ index: 9, note: "" })).statusCode).toBe(409);
    expect((await post({ index: 42, note: "" })).statusCode).toBe(400);
    expect((await post({ index: "x", note: "" })).statusCode).toBe(400);
    expect((await post({ index: 0, note: "x".repeat(301) })).statusCode).toBe(400);
    const noKey = await signedIn(setup());
    expect((await noKey.app.inject({ method: "POST", url: "/api/days/today/alternative", headers: noKey.headers, payload: { index: 0, note: "" } })).statusCode).toBe(503);

    const credit = setup(async () => Promise.reject(new RecognitionError("credit", "no credit")));
    const c = await signedIn(credit);
    const entry = await openIndex(credit);
    expect((await c.app.inject({ method: "POST", url: "/api/days/today/alternative", headers: c.headers, payload: { index: entry.index, note: "" } })).statusCode).toBe(402);

    const off = { training: true, health: true, reminders: true, water: true, photoMeals: false };
    expect(blockedBy("/api/days/today/alternative", (key) => off[key])).toBe("photoMeals");
    expect(blockedBy("/api/days/today", (key) => off[key])).toBeNull();
  });

  it("says there is no plan when none is in effect", async () => {
    const deps = setup(async () => answer);
    deps.plans = new PlanStore(openDatabase(":memory:"));
    const { app, headers } = await signedIn(deps);
    expect((await app.inject({ method: "POST", url: "/api/days/today/alternative", headers, payload: { index: 0, note: "" } })).statusCode).toBe(404);
  });
});
