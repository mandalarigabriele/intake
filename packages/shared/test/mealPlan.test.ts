import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mealPlanJsonSchema, mealPlanSchema } from "../src/mealPlan.js";

const root = new URL("../../../", import.meta.url);
const example = JSON.parse(readFileSync(new URL("examples/meal-plan.example.json", root), "utf8"));

function withFirstMealMacros(macros: Record<string, unknown>) {
  const plan = structuredClone(example);
  plan.days.monday.meals[0].macros = macros;
  return plan;
}

const base = { kcal: 400, protein: 30, carbs: 40, fat: 12, fiber: 5 };

describe("mealPlanSchema", () => {
  it("accepts the example plan", () => {
    expect(mealPlanSchema.safeParse(example).success).toBe(true);
  });

  it("accepts a meal with only the required macros", () => {
    expect(mealPlanSchema.safeParse(withFirstMealMacros(base)).success).toBe(true);
  });

  it("rejects sugar without addedSugar", () => {
    expect(mealPlanSchema.safeParse(withFirstMealMacros({ ...base, sugar: 10 })).success).toBe(false);
  });

  it("rejects addedSugar greater than sugar", () => {
    const result = mealPlanSchema.safeParse(withFirstMealMacros({ ...base, sugar: 5, addedSugar: 6 }));
    expect(result.success).toBe(false);
  });

  it("rejects saturatedFat greater than fat", () => {
    const result = mealPlanSchema.safeParse(withFirstMealMacros({ ...base, saturatedFat: 13 }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(mealPlanSchema.safeParse(withFirstMealMacros({ ...base, salt: 1 })).success).toBe(false);
  });

  it("rejects an invalid validFrom date", () => {
    expect(mealPlanSchema.safeParse({ ...example, validFrom: "2026-02-30" }).success).toBe(false);
  });

  it("rejects a plan with a missing day", () => {
    const plan = structuredClone(example);
    delete plan.days.sunday;
    expect(mealPlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe("schemas/meal-plan.schema.json", () => {
  it("is in sync with the zod schema (run `npm run schema` to regenerate)", () => {
    const committed = JSON.parse(readFileSync(new URL("schemas/meal-plan.schema.json", root), "utf8"));
    expect(committed).toEqual(mealPlanJsonSchema());
  });
});
