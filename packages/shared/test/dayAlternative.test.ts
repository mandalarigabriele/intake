import { describe, expect, it } from "vitest";
import { dayAlternativeSchema, dayBudget, DAY_ALTERNATIVE_JSON_SCHEMA } from "../src/index.js";

const goals = { kcal: 2000, protein: 135, carbs: 230, fat: 65, fiber: 30 };

describe("dayBudget", () => {
  it("is the goals minus what is eaten and what the other planned meals still bring", () => {
    const budget = dayBudget(goals, { kcal: 700, protein: 40, carbs: 80, fat: 20, fiber: 8 }, { kcal: 650, protein: 45, carbs: 70, fat: 20, fiber: 9 }, null);
    expect(budget).toEqual({ kcal: 650, protein: 50, carbs: 80, fat: 25, fiber: 13 });
  });

  it("never goes negative: a day over its goals still gets a small meal", () => {
    const budget = dayBudget(goals, { kcal: 2100, protein: 150, carbs: 300, fat: 90, fiber: 35 }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, null);
    expect(budget).toEqual({ kcal: 150, protein: 5, carbs: 0, fat: 0, fiber: 0 });
  });

  it("uses the meal's own planned values where there is no goal, and null when it has none either", () => {
    const none = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    const noGoals = { kcal: null, protein: null, carbs: null, fat: null, fiber: null };
    expect(dayBudget(noGoals, none, none, { kcal: 600, protein: 40, carbs: 70, fat: 15, fiber: 6 })).toEqual({ kcal: 600, protein: 40, carbs: 70, fat: 15, fiber: 6 });
    expect(dayBudget(noGoals, none, none, null)).toEqual(noGoals);
  });
});

describe("dayAlternativeSchema", () => {
  const food = { name: "Orata", quantity: 200, unit: "g", kcal: 220, protein: 40, carbs: 0, fat: 6, fiber: 0, sugar: 0, addedSugar: 0 };
  it("accepts an answer in the shape of the JSON schema and refuses extra or missing fields", () => {
    expect(dayAlternativeSchema.safeParse({ description: "Orata", reason: "Leggera", foods: [food] }).success).toBe(true);
    expect(dayAlternativeSchema.safeParse({ description: "Orata", reason: "", foods: [] }).success).toBe(false);
    expect(dayAlternativeSchema.safeParse({ description: "Orata", reason: "", foods: [{ ...food, extra: 1 }] }).success).toBe(false);
    expect(DAY_ALTERNATIVE_JSON_SCHEMA.required).toEqual(["description", "reason", "foods"]);
    expect(Object.keys(DAY_ALTERNATIVE_JSON_SCHEMA.properties.foods.items.properties).sort()).toEqual(Object.keys(food).sort());
  });
});
