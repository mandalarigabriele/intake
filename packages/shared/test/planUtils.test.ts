import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mealPlanSchema, type PlannedMeal } from "../src/mealPlan.js";
import { dayTotals, foodLine, mealFoodsText, mealTimes, mealTypeOf, planAverages, weekdayOf } from "../src/planUtils.js";

const example = mealPlanSchema.parse(
  JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")),
);

const fixed = (title: string, extra: Partial<PlannedMeal> = {}): PlannedMeal =>
  ({ title, foods: [{ name: "x" }], macros: { kcal: 100, protein: 10, carbs: 10, fat: 1, fiber: 1 }, ...extra }) as PlannedMeal;

describe("schema rules for plans written by Claude", () => {
  it("accepts meals without time, free meals, day labels and notes", () => {
    expect(example.days.saturday.meals.at(-1)).toEqual({ title: "Cena", free: true });
    expect(example.days.wednesday.label).toBe("dolce");
    expect(example.days.monday.meals[0]!.time).toBeUndefined();
  });

  it("rejects a free meal with foods", () => {
    const plan = structuredClone(example);
    (plan.days.saturday.meals[4] as Record<string, unknown>).foods = [{ name: "pizza" }];
    expect(mealPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("accepts a fixed meal without macros (it is shown, but cannot be logged as planned)", () => {
    const plan = structuredClone(example);
    delete (plan.days.monday.meals[0] as Record<string, unknown>).macros;
    expect(mealPlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe("plan helpers", () => {
  it("finds the weekday of a date", () => {
    expect(weekdayOf("2026-11-05")).toBe("thursday");
    expect(weekdayOf("2026-11-08")).toBe("sunday");
    expect(weekdayOf("2026-11-09")).toBe("monday");
  });

  it("infers meal types from type, title or time", () => {
    expect(mealTypeOf(fixed("Pranzo in famiglia"))).toBe("lunch");
    expect(mealTypeOf(fixed("Spuntino dolce"))).toBe("snack");
    expect(mealTypeOf(fixed("Qualcosa", { type: "dinner" }))).toBe("dinner");
    expect(mealTypeOf(fixed("Qualcosa", { time: "07:30" }))).toBe("breakfast");
    expect(mealTypeOf(fixed("Qualcosa"))).toBe("snack");
  });

  it("uses default slots for meals without a time", () => {
    expect(mealTimes(example.days.thursday.meals)).toEqual(["08:00", "11:00", "13:00", "16:00", "20:00"]);
    expect(mealTimes([fixed("Spuntino"), fixed("Pranzo"), fixed("Spuntino")])).toEqual(["11:00", "13:00", "16:00"]);
  });

  it("formats food lines", () => {
    expect(foodLine({ name: "Yogurt greco", quantity: 150, unit: "g" })).toBe("Yogurt greco 150 g");
    expect(foodLine({ name: "Banana", quantity: 1 })).toBe("Banana 1");
    expect(foodLine({ name: "Olio", quantity: 2.5, unit: "ml" })).toBe("Olio 2,5 ml");
    expect(foodLine({ name: "1 frutto" })).toBe("1 frutto");
    expect(mealFoodsText(example.days.thursday.meals[1]!)).toBe("1 frutto + Bresaola 40 g");
  });

  it("sums a day and averages fully planned days", () => {
    expect(dayTotals(example.days.saturday).hasFreeMeal).toBe(true);
    expect(dayTotals(example.days.thursday)).toEqual({ kcal: 2070, protein: 135, hasFreeMeal: false });
    const averages = planAverages(example)!;
    expect(Math.round(averages.kcal!)).toBeGreaterThan(1800);
  });
});

describe("Claude Fitness import", () => {
  const cf = JSON.parse(readFileSync(new URL("../../../examples/claude-fitness-plan.example.json", import.meta.url), "utf8"));

  it("converts slots, free meals, sweet snacks, family lunch, alternatives and notes", async () => {
    const { importPlan } = await import("../src/claudeFitness.js");
    const result = importPlan(cf);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    const { plan } = result;
    expect(plan.validFrom).toBe("2026-11-05");
    expect(plan.notes).toHaveLength(7);
    expect(plan.days.thursday.meals.map((m) => [m.time, m.title, m.type])).toEqual([
      ["07:44", "Colazione", "breakfast"],
      ["11:00", "Spuntino", "snack"],
      ["13:00", "Pranzo", "lunch"],
      ["16:00", "Spuntino", "snack"],
      ["20:00", "Cena", "dinner"],
    ]);
    expect(plan.days.wednesday).toMatchObject({ label: "dolce", expectedProtein: 135 });
    expect(plan.days.wednesday.meals[3]!.title).toBe("Spuntino dolce");
    expect(plan.days.saturday).toMatchObject({ label: "libero", note: "pranzo in famiglia · cena libera", expectedProtein: 95 });
    expect(plan.days.saturday.meals[4]).toMatchObject({ title: "Cena", free: true });
    expect(plan.days.sunday.meals[2]).toMatchObject({ title: "Pranzo", free: true });
    const lunch = plan.days.monday.meals[2]!;
    expect(lunch.description).toBe("Pasta 120 g al pomodoro con tonno al naturale 100 g + insalata");
    expect("foods" in lunch && lunch.foods[0]).toEqual({ name: "Pasta", quantity: 120, unit: "g", note: "a crudo" });
    expect("foods" in lunch && lunch.foods[1]).toEqual({ name: "Pomodoro/passata" });
  });

  it("uses per-meal macros when the file has them", async () => {
    const { importPlan } = await import("../src/claudeFitness.js");
    const withMacros = structuredClone(cf);
    withMacros.days[0].meals.breakfast.macros = { kcal: 430, protein_g: 27, carbs_g: 62, fat_g: 8, fiber_g: 6, sugar_g: 28, added_sugar_g: 6 };
    const result = importPlan(withMacros);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect("macros" in result.plan.days.monday.meals[0]! && result.plan.days.monday.meals[0].macros).toEqual({
      kcal: 430, protein: 27, carbs: 62, fat: 8, fiber: 6, sugar: 28, addedSugar: 6,
    });
  });

  it("reports missing days and invalid fields", async () => {
    const { importPlan } = await import("../src/claudeFitness.js");
    const broken = structuredClone(cf);
    broken.days = broken.days.slice(0, 6);
    const result = importPlan(broken);
    expect(result.success).toBe(false);
    expect(!result.success && result.issues[0]!.message).toBe("missing sunday");
  });
});
