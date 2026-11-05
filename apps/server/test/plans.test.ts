import { readFileSync } from "node:fs";
import { mealPlanSchema, type Meal, type MealPlan } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { PlanStore } from "../src/db/planStore.js";
import { parseGoalProgress } from "../src/parsers/goalProgress.js";
import { parseMeals } from "../src/parsers/meals.js";
import type { DayRoutesOptions } from "../src/routes/days.js";
import { logPlannedMeal } from "../src/services/logPlanned.js";
import { plannedEntries } from "../src/services/planMatching.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const examplePlan: MealPlan = mealPlanSchema.parse(
  JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")),
);

const planOn = (validFrom: string): MealPlan => ({ ...examplePlan, validFrom });

function meal(id: string, time: string, type: string, date = "2026-11-05"): Meal {
  return {
    id,
    date,
    time,
    type,
    description: `${type} ${time}`,
    notes: null,
    items: [],
    nutrients: {
      kcal: 400, protein: 20, carbs: 40, fat: 10,
      saturatedFat: null, transFat: null, fiber: 3, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null,
    },
  };
}

describe("PlanStore", () => {
  it("activates the plan with the latest validFrom on or before the date and keeps history", () => {
    let clock = new Date("2026-11-01T10:00:00Z");
    const store = new PlanStore(openDatabase(":memory:"), () => clock);
    const first = store.add(planOn("2026-11-02"));
    clock = new Date("2026-11-03T10:00:00Z");
    const second = store.add(planOn("2026-11-09"));

    expect(store.activeOn("2026-11-01")).toBeNull();
    expect(store.activeOn("2026-11-05")?.id).toBe(first.id);
    expect(store.activeOn("2026-11-09")?.id).toBe(second.id);
    expect(store.versions("2026-11-05").map((v) => [v.id, v.status])).toEqual([
      [second.id, "scheduled"],
      [first.id, "active"],
    ]);
  });

  it("prefers the latest upload when two versions share validFrom", () => {
    let clock = new Date("2026-11-01T10:00:00Z");
    const store = new PlanStore(openDatabase(":memory:"), () => clock);
    store.add(planOn("2026-11-02"));
    clock = new Date("2026-11-04T10:00:00Z");
    const fixedVersion = store.add(planOn("2026-11-02"));
    expect(store.activeOn("2026-11-05")?.id).toBe(fixedVersion.id);
  });

  it("stores links per date and planned meal", () => {
    const store = new PlanStore(openDatabase(":memory:"));
    const plan = store.add(planOn("2026-11-02"));
    store.addLink("2026-11-05", plan.id, 2, "meal-a");
    store.addLink("2026-11-05", plan.id, 2, "meal-b");
    expect(store.linksOn("2026-11-05")).toEqual([{ planId: plan.id, index: 2, mealId: "meal-b" }]);
    expect(store.linksOn("2026-11-06")).toEqual([]);
  });
});

describe("plannedEntries (Thursday of the example plan)", () => {
  const stored = { id: 1, validFrom: "2026-11-04", uploadedAt: "", plan: examplePlan };
  const context = { date: "2026-11-05", today: "2026-11-05", now: "13:17:00" };

  it("marks passed meals as to-log and upcoming meals as planned", () => {
    const entries = plannedEntries(stored, [], [], context);
    expect(entries.map((e) => [e.time, e.title, e.status])).toEqual([
      ["08:00", "Colazione", "todo"],
      ["11:00", "Spuntino", "todo"],
      ["13:00", "Pranzo", "todo"],
      ["16:00", "Spuntino", "planned"],
      ["20:00", "Cena", "planned"],
    ]);
    expect(entries[1]!.foods).toBe("1 frutto + Bresaola 40 g");
  });

  it("hides a planned meal covered by a logged meal of the same type nearby (e.g. logged through Claude)", () => {
    const entries = plannedEntries(stored, [meal("b", "08:03", "breakfast")], [], context);
    expect(entries.map((e) => e.title)).toEqual(["Spuntino", "Pranzo", "Spuntino", "Cena"]);
  });

  it("does not match meals of another type or too far in time", () => {
    // A dinner at 08:30 does not cover breakfast; a snack at 19:30 is more than 3 hours from the 16:00 snack
    const entries = plannedEntries(stored, [meal("d", "08:30", "dinner"), meal("s", "19:30", "snack")], [], context);
    expect(entries.filter((e) => e.type === "snack").map((e) => e.time)).toEqual(["11:00", "16:00"]);
    expect(entries.some((e) => e.title === "Colazione")).toBe(true);
  });

  it("lets each logged meal cover only one planned meal, nearest first", () => {
    const entries = plannedEntries(stored, [meal("s", "15:30", "snack")], [], context);
    expect(entries.filter((e) => e.type === "snack").map((e) => e.time)).toEqual(["11:00"]);
  });

  it("honors explicit links, and ignores links to deleted meals", () => {
    const linked = plannedEntries(stored, [meal("x", "21:30", "snack")], [{ planId: 1, index: 4, mealId: "x" }], context);
    expect(linked.some((e) => e.title === "Cena")).toBe(false);
    const stale = plannedEntries(stored, [], [{ planId: 1, index: 4, mealId: "gone" }], context);
    expect(stale.some((e) => e.title === "Cena")).toBe(true);
  });

  it("shows free meals as free, and treats past days as fully passed", () => {
    const saturday = plannedEntries(stored, [], [], { date: "2026-11-07", today: "2026-11-05", now: "10:00" });
    expect(saturday.at(-1)).toMatchObject({ title: "Cena", status: "free", macros: null });
    expect(saturday.slice(0, -1).every((e) => e.status === "planned")).toBe(true);
    const wednesday = plannedEntries(stored, [], [], { date: "2026-11-04", today: "2026-11-05", now: "10:00" });
    expect(wednesday.every((e) => e.status === "todo")).toBe(true);
  });

  it("returns nothing without a plan", () => {
    expect(plannedEntries(null, [], [], context)).toEqual([]);
  });
});

describe("logPlannedMeal", () => {
  function setup(response: { id: string | null }, meals: Meal[] = []) {
    const store = new PlanStore(openDatabase(":memory:"));
    const plan = store.add(planOn("2026-11-02"));
    const logMeal = vi.fn(async () => response);
    const api = { logMeal, mealsByDate: vi.fn(async () => ({ timezone: null, meals })) };
    return { store, plan, logMeal, api };
  }

  it("logs a passed planned meal at its time with full nutrients, an idempotency key, and links it", async () => {
    const { store, plan, logMeal, api } = setup({ id: "new-meal" });
    await logPlannedMeal(api, store, { date: "2026-11-05", planId: plan.id, index: 2, today: "2026-11-05", now: "13:30:00" });
    expect(logMeal).toHaveBeenCalledWith({
      description: "Pranzo: Pasta al ragù magro di manzo 100 g + Insalata",
      meal_type: "lunch",
      calories: 650,
      protein_g: 40,
      carbs_g: 80,
      fat_g: 16,
      fiber_g: 7,
      sugar_g: 8,
      added_sugar_g: 0,
      saturated_fat_g: 6,
      sodium_mg: 420,
      logged_at: "2026-11-05T13:00",
      idempotency_key: `intake-plan-${plan.id}-2026-11-05-2`,
    });
    expect(store.linksOn("2026-11-05")).toEqual([{ planId: plan.id, index: 2, mealId: "new-meal" }]);
  });

  it("logs an upcoming meal now (no logged_at)", async () => {
    const { store, plan, logMeal, api } = setup({ id: "m" });
    await logPlannedMeal(api, store, { date: "2026-11-05", planId: plan.id, index: 4, today: "2026-11-05", now: "13:30:00" });
    expect((logMeal.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]).not.toHaveProperty("logged_at");
  });

  it("finds the new meal when the response has no id", async () => {
    const logged = { ...meal("found", "13:00", "lunch"), description: "Pranzo: Pasta al ragù magro di manzo 100 g + Insalata" };
    const { store, plan, api } = setup({ id: null }, [logged]);
    const result = await logPlannedMeal(api, store, { date: "2026-11-05", planId: plan.id, index: 2, today: "2026-11-05", now: "14:00" });
    expect(result.mealId).toBe("found");
  });

  it("refuses free meals and unknown indexes", async () => {
    const { store, plan, api } = setup({ id: "m" });
    await expect(logPlannedMeal(api, store, { date: "2026-11-07", planId: plan.id, index: 4, today: "2026-11-07", now: "22:00" })).rejects.toThrow(
      "Planned meal not found",
    );
    await expect(logPlannedMeal(api, store, { date: "2026-11-05", planId: plan.id, index: 9, today: "2026-11-05", now: "22:00" })).rejects.toThrow();
  });
});

describe("plan routes", () => {
  const clock = { timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "13:17:00", utc: "2026-11-05T12:17:00Z" };
  const api: DayRoutesOptions["api"] = {
    clock: async () => clock,
    goalProgress: async () => parseGoalProgress(JSON.parse(fixture("goal-progress.json"))).value,
    mealsByDate: async () => parseMeals(fixture("meals-full-today.txt")).value,
    addWater: async () => {},
    logMeal: async () => ({ id: "logged-id" }),
  };

  async function signedIn() {
    const plans = new PlanStore(openDatabase(":memory:"));
    const app = await buildApp({ auth: authOptions(), api, plans });
    const { cookie } = await signIn(app);
    return { app, plans, headers: { cookie } };
  }

  it("uploads a valid plan and lists it as active", async () => {
    const { app, headers } = await signedIn();
    const upload = await app.inject({ method: "POST", url: "/api/plans", headers, payload: examplePlan });
    expect(upload.statusCode).toBe(201);
    const list = (await app.inject({ method: "GET", url: "/api/plans", headers })).json();
    expect(list.active.validFrom).toBe("2026-11-04");
    expect(list.versions).toHaveLength(1);
    expect(list.versions[0].status).toBe("active");
  });

  it("rejects an invalid plan with readable issues", async () => {
    const { app, headers } = await signedIn();
    const response = await app.inject({ method: "POST", url: "/api/plans", headers, payload: { ...examplePlan, validFrom: "domani" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0]).toMatchObject({ path: "validFrom" });
  });

  it("includes planned meals in the day view, with breakfast covered by the logged one", async () => {
    const { app, headers } = await signedIn();
    await app.inject({ method: "POST", url: "/api/plans", headers, payload: examplePlan });
    const before = (await app.inject({ method: "GET", url: "/api/days/2026-11-03", headers })).json();
    expect(before.hasPlan).toBe(false);
    const day = (await app.inject({ method: "GET", url: "/api/days/today", headers })).json();
    expect(day.hasPlan).toBe(true);
    expect(day.planned.map((p: { title: string; status: string }) => `${p.title}:${p.status}`)).toEqual([
      "Spuntino:todo",
      "Pranzo:todo",
      "Spuntino:planned",
      "Cena:planned",
    ]);
  });

  it("logs a planned meal and stops showing it", async () => {
    const { app, plans, headers } = await signedIn();
    const plan = (await app.inject({ method: "POST", url: "/api/plans", headers, payload: examplePlan })).json();
    const response = await app.inject({ method: "POST", url: `/api/days/2026-11-05/planned/${plan.id}/2`, headers });
    expect(response.statusCode).toBe(201);
    expect(plans.linksOn("2026-11-05")).toEqual([{ planId: plan.id, index: 2, mealId: "logged-id" }]);
  });

  it("returns 404 for a missing planned meal and requires sign-in", async () => {
    const { app, headers } = await signedIn();
    expect((await app.inject({ method: "POST", url: "/api/days/2026-11-05/planned/99/0", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/plans" })).statusCode).toBe(401);
  });
});

describe("Claude Fitness plan upload", () => {
  const cfPlan = JSON.parse(readFileSync(new URL("../../../examples/claude-fitness-plan.example.json", import.meta.url), "utf8"));
  const clock = { timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "13:17:00", utc: "2026-11-05T12:17:00Z" };
  const api: DayRoutesOptions["api"] = {
    clock: async () => clock,
    goalProgress: async () => parseGoalProgress(JSON.parse(fixture("goal-progress.json"))).value,
    mealsByDate: async () => parseMeals(fixture("meals-full-today.txt")).value,
    addWater: async () => {},
    logMeal: async () => ({ id: "logged-id" }),
  };

  it("accepts the real Claude Fitness file and shows its meals in the timeline", async () => {
    const plans = new PlanStore(openDatabase(":memory:"));
    const app = await buildApp({ auth: authOptions(), api, plans });
    const { cookie } = await signIn(app);
    const headers = { cookie };

    const upload = await app.inject({ method: "POST", url: "/api/plans", headers, payload: cfPlan });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().validFrom).toBe("2026-11-05");

    const day = (await app.inject({ method: "GET", url: "/api/days/today", headers })).json();
    expect(day.planned.map((p: { time: string; status: string; macros: unknown }) => [p.time, p.status, p.macros])).toEqual([
      ["11:00", "todo", null],
      ["13:00", "todo", null],
      ["16:00", "planned", null],
      ["20:00", "planned", null],
    ]);

    // Without nutrients in the plan, "Mangiato come previsto" refuses instead of logging an empty meal
    const log = await app.inject({ method: "POST", url: `/api/days/2026-11-05/planned/${upload.json().id}/1`, headers });
    expect(log.statusCode).toBe(422);
    expect(log.json().error).toBe("missing_macros");
  });
});
