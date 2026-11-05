import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseMeals } from "../src/parsers/meals.js";
import type { MealRoutesOptions } from "../src/routes/meals.js";
import { copyMealFields, recentDistinctMeals, updateMealFields } from "../src/services/mealWrites.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const byDate = parseMeals(fixture("meals-full-by-date.txt")).value.meals;
const ricotta = byDate[1]!;
const espresso = byDate[0]!;

describe("copyMealFields", () => {
  it("copies an itemized meal item by item, leaving out unmeasured nutrients", () => {
    const fields = copyMealFields(ricotta);
    expect(fields.description).toBe("Ricotta (150 g) con miele (2 cucchiaini)");
    expect(fields.meal_type).toBe("snack");
    expect(fields.items).toEqual([
      { name: "Ricotta vaccina", amount: 150, unit: "g", calories: 219, protein_g: 13.2, carbs_g: 5.3, fat_g: 16.4, saturated_fat_g: 10.4, fiber_g: 0, sugar_g: 5.3, added_sugar_g: 0, sodium_mg: 120 },
      { name: "Miele", amount: 2, unit: "cucchiaini", calories: 43, protein_g: 0, carbs_g: 11.5, fat_g: 0, saturated_fat_g: 0, fiber_g: 0, sugar_g: 11.4, added_sugar_g: 11.4, sodium_mg: 1 },
    ]);
    expect(fields).not.toHaveProperty("calories");
  });

  it("copies a meal without items through its totals", () => {
    expect(copyMealFields(espresso)).toMatchObject({ calories: 2, protein_g: 0.1, caffeine_mg: 63, sodium_mg: 4 });
  });
});

describe("updateMealFields", () => {
  it("sends type, time, description and the full item list", () => {
    const fields = updateMealFields({
      date: "2026-11-04",
      time: "17:30",
      type: "snack",
      description: "Ricotta vaccina 100 g",
      items: [{ name: "Ricotta vaccina", quantity: 100, unit: "g", nutrients: { ...ricotta.items[0]!.nutrients, kcal: 146 } }],
    });
    expect(fields).toMatchObject({ meal_type: "snack", logged_at: "2026-11-04T17:30", description: "Ricotta vaccina 100 g" });
    expect(fields.items).toHaveLength(1);
    expect(fields.items![0]).toMatchObject({ name: "Ricotta vaccina", amount: 100, calories: 146 });
  });

  it("sends totals for a meal without items", () => {
    const fields = updateMealFields({ date: "2026-11-04", time: "16:31", type: "snack", description: "Caffè", totals: { kcal: 3, protein: 0.2, carbs: 0.4, fat: 0 } });
    expect(fields).toMatchObject({ calories: 3, protein_g: 0.2, carbs_g: 0.4, fat_g: 0 });
    expect(fields).not.toHaveProperty("items");
  });
});

describe("recentDistinctMeals", () => {
  it("keeps the newest meal per description", () => {
    const recent = recentDistinctMeals(byDate, 10);
    expect(recent.map((m) => m.time)).toEqual(["20:10", "20:06", "17:05", "17:02"]);
  });
});

describe("meal routes", () => {
  function fakeApi(overrides: Partial<MealRoutesOptions["api"]> = {}): MealRoutesOptions["api"] {
    return {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "15:00:00", utc: "" }),
      mealsByDate: async () => ({ timezone: null, meals: byDate }),
      mealsByRange: async () => parseMeals(fixture("meals-full-range.txt")).value,
      logMeal: async () => ({ id: "copy-id" }),
      updateMeal: async () => {},
      deleteMeal: async () => {},
      saveMeal: async () => {},
      ...overrides,
    };
  }

  async function signedIn(api: MealRoutesOptions["api"]) {
    const app = await buildApp({ auth: authOptions(), mealsApi: api });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("lists recent distinct meals over the last two weeks", async () => {
    const mealsByRange = vi.fn(fakeApi().mealsByRange);
    const { app, headers } = await signedIn(fakeApi({ mealsByRange }));
    const response = await app.inject({ method: "GET", url: "/api/meals/recent", headers });
    expect(mealsByRange).toHaveBeenCalledWith("2026-10-23", "2026-11-05");
    expect(response.json().meals.map((m: { time: string }) => m.time)).toEqual(["14:02", "20:10", "17:02"]);
  });

  it("repeats a meal now with an idempotency key", async () => {
    const logMeal = vi.fn(async () => ({ id: "copy-id" }));
    const { app, headers } = await signedIn(fakeApi({ logMeal }));
    const response = await app.inject({
      method: "POST",
      url: `/api/meals/${ricotta.id}/repeat`,
      headers,
      payload: { date: "2026-11-04", idempotencyKey: "tap-123456" },
    });
    expect(response.statusCode).toBe(201);
    const sent = (logMeal.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
    expect(sent).toMatchObject({ description: ricotta.description, idempotency_key: "tap-123456" });
    expect(sent).not.toHaveProperty("logged_at");
  });

  it("returns 404 when repeating an unknown meal", async () => {
    const { app, headers } = await signedIn(fakeApi());
    const response = await app.inject({ method: "POST", url: "/api/meals/nope/repeat", headers, payload: { date: "2026-11-04", idempotencyKey: "tap-123456" } });
    expect(response.statusCode).toBe(404);
  });

  it("updates, deletes and saves meals as favorites", async () => {
    const updateMeal = vi.fn(async () => {});
    const deleteMeal = vi.fn(async () => {});
    const saveMeal = vi.fn(async () => {});
    const { app, headers } = await signedIn(fakeApi({ updateMeal, deleteMeal, saveMeal }));

    const update = await app.inject({
      method: "PATCH",
      url: `/api/meals/${espresso.id}`,
      headers,
      payload: { date: "2026-11-04", time: "16:40", type: "snack", description: "Caffè", totals: { kcal: 2, protein: 0.1, carbs: 0.3, fat: 0 } },
    });
    expect(update.statusCode).toBe(200);
    expect(updateMeal).toHaveBeenCalledWith(espresso.id, expect.objectContaining({ logged_at: "2026-11-04T16:40" }));

    expect((await app.inject({ method: "DELETE", url: `/api/meals/${espresso.id}`, headers })).statusCode).toBe(200);
    expect(deleteMeal).toHaveBeenCalledWith(espresso.id);

    const favorite = await app.inject({ method: "POST", url: `/api/meals/${ricotta.id}/favorite`, headers, payload: { name: "Ricotta e miele" } });
    expect(favorite.statusCode).toBe(201);
    expect(saveMeal).toHaveBeenCalledWith("Ricotta e miele", ricotta.id);
  });

  it("rejects invalid edits and requires sign-in", async () => {
    const { app, headers } = await signedIn(fakeApi());
    const noValues = await app.inject({ method: "PATCH", url: "/api/meals/x", headers, payload: { date: "2026-11-04", time: "16:40", type: "snack", description: "Caffè" } });
    expect(noValues.statusCode).toBe(400);
    const badType = await app.inject({ method: "PATCH", url: "/api/meals/x", headers, payload: { date: "2026-11-04", time: "16:40", type: "brunch", description: "x", totals: { kcal: 1, protein: 0, carbs: 0, fat: 0 } } });
    expect(badType.statusCode).toBe(400);
    const anonymous = await buildApp({ auth: authOptions(), mealsApi: fakeApi() });
    expect((await anonymous.inject({ method: "DELETE", url: "/api/meals/x" })).statusCode).toBe(401);
  });
});
