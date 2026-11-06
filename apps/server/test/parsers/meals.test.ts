import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/parsers/common.js";
import { parseMeals } from "../../src/parsers/meals.js";
import { fixture } from "./fixtures.js";

describe("parseMeals – real responses", () => {
  it("parses a meal with items, caffeine and no sodium or saturated fat", () => {
    const { value, warnings } = parseMeals(fixture("meals-full-today.txt"));
    expect(warnings).toEqual([]);
    expect(value.timezone).toBe("Europe/Rome");
    expect(value.meals).toHaveLength(1);

    const [breakfast] = value.meals;
    expect(breakfast).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      date: "2026-11-05",
      time: "08:03",
      type: "breakfast",
      notes: null,
      nutrients: {
        kcal: 438,
        protein: 28.2,
        carbs: 68.9,
        fat: 7,
        fiber: 7.1,
        sugar: 29.5,
        addedSugar: 0,
        caffeineMg: 63,
        saturatedFat: null,
        sodiumMg: null,
      },
    });
    expect(breakfast!.description).toMatch(/^Colazione: caffellatte/);
    expect(breakfast!.items).toHaveLength(4);
    expect(breakfast!.items[0]).toEqual({
      name: "Caffellatte (latte parz. scremato 200 ml + caffè)",
      quantityText: "200 ml",
      quantity: 200,
      unit: "ml",
      nutrients: {
        kcal: 92,
        protein: 6.6,
        carbs: 9.6,
        fat: 3.2,
        saturatedFat: null,
        transFat: null,
        fiber: 0,
        sugar: 9.6,
        addedSugar: 0,
        alcohol: null,
        caffeineMg: 63,
        sodiumMg: null,
      },
    });
  });

  it("parses several meals with saturated fat, sodium, added sugar and non-metric units", () => {
    const { value, warnings } = parseMeals(fixture("meals-full-by-date.txt"));
    expect(warnings).toEqual([]);
    expect(value.meals.map((m) => m.time)).toEqual(["16:31", "17:02", "17:05", "20:06", "20:10"]);

    const ricotta = value.meals[1]!;
    expect(ricotta.nutrients).toMatchObject({ saturatedFat: 10.4, sugar: 16.7, addedSugar: 11.4, sodiumMg: 121, caffeineMg: null });
    expect(ricotta.items[1]).toMatchObject({ name: "Miele", quantityText: "2 cucchiaini", quantity: 2, unit: "cucchiaini" });
    expect(ricotta.items[1]!.nutrients).toMatchObject({ addedSugar: 11.4, sodiumMg: 1, saturatedFat: 0 });

    const dinner = value.meals[3]!;
    expect(dinner.items).toHaveLength(6);
    expect(dinner.nutrients.saturatedFat).toBe(4.68);
    expect(dinner.description).toContain("con 1 cucchiaino di olio EVO");

    const espresso = value.meals[0]!;
    expect(espresso.items).toEqual([]);
    expect(espresso.nutrients).toMatchObject({ kcal: 2, fat: 0, saturatedFat: 0, caffeineMg: 63, sodiumMg: 4 });
  });

  it("returns no meals for an empty day", () => {
    expect(parseMeals(fixture("meals-empty.txt"))).toEqual({ value: { timezone: null, meals: [] }, warnings: [] });
  });
});

// Synthetic inputs: variations the server may produce that are not covered by real fixtures yet
describe("parseMeals – robustness", () => {
  const block = (extra: string) =>
    `Times are local (Europe/Rome).\n\nID: abc\nTime: 2026-11-05 12:30\nType: lunch\nDescription: Pasta\nCalories: 500\nProtein: 20g\nCarbs: 80g\nFat: 10g\n${extra}`;

  it("treats non-numeric optional values as not measured", () => {
    const { value, warnings } = parseMeals(block("Fiber: not measured\nSugar: not recorded"));
    expect(warnings).toEqual([]);
    expect(value.meals[0]!.nutrients).toMatchObject({ fiber: null, sugar: null, addedSugar: null });
  });

  it("keeps notes and multi-line descriptions", () => {
    const { value } = parseMeals(block("Notes: eaten at the office").replace("Description: Pasta", "Description: Pasta\nwith tomato sauce"));
    expect(value.meals[0]!.description).toBe("Pasta\nwith tomato sauce");
    expect(value.meals[0]!.notes).toBe("eaten at the office");
  });

  it("reports unknown fields and nutrients as warnings instead of failing", () => {
    const { value, warnings } = parseMeals(
      block("Potassium: 300 mg\nItems:\n  1. Pasta — 100 g — 350 kcal · P 12 g · C 70 g · F 1.5 g · potassium 200 mg"),
    );
    expect(value.meals[0]!.items[0]!.nutrients.kcal).toBe(350);
    expect(warnings).toEqual(['meal #1: unknown field "Potassium"', 'meal abc item 1: unrecognized nutrient "potassium 200 mg"']);
  });

  it("keeps item names that contain an em dash", () => {
    const { value } = parseMeals(block("Items:\n  1. Pizza — margherita — 1 slice — 280 kcal · P 12 g · C 33 g · F 10 g"));
    expect(value.meals[0]!.items[0]).toMatchObject({ name: "Pizza — margherita", quantity: 1, unit: "slice" });
  });

  it("parses approximate quantities and quantities without a number", () => {
    const { value } = parseMeals(
      block("Items:\n  1. Rice — ~80 g — 290 kcal · P 6 g · C 64 g · F 1 g\n  2. Salt — a pinch — 0 kcal · P 0 g · C 0 g · F 0 g"),
    );
    expect(value.meals[0]!.items[0]).toMatchObject({ quantity: 80, unit: "g" });
    expect(value.meals[0]!.items[1]).toMatchObject({ quantityText: "a pinch", quantity: null, unit: null });
  });

  it("throws when a meal has no ID", () => {
    expect(() => parseMeals("Time: 2026-11-05 12:30\nCalories: 500")).toThrow(ParseError);
  });
});

describe("parseMeals – date range", () => {
  it("parses meals grouped by day, ignoring headings and the Sources line", () => {
    const { value, warnings } = parseMeals(fixture("meals-full-range.txt"));
    expect(warnings).toEqual([]);
    expect(value.meals.map((m) => [m.date, m.time, m.type])).toEqual([
      ["2026-11-04", "17:02", "snack"],
      ["2026-11-04", "20:10", "dinner"],
      ["2026-11-05", "14:02", "lunch"],
    ]);
    expect(value.meals[2]!.items).toHaveLength(6);
    expect(value.meals[2]!.items[4]).toMatchObject({ name: "Sale", nutrients: { sodiumMg: 400 } });
  });
});

describe("parseMealPatterns", () => {
  it("parses the window and the breakfast effect", async () => {
    const { parseMealPatterns } = await import("../../src/parsers/mealPatterns.js");
    expect(parseMealPatterns(fixture("meal-patterns-7d.txt")).value).toEqual({
      startDate: "2026-10-31",
      endDate: "2026-11-06",
      loggedDays: 3,
      windowDays: 7,
      breakfast: {
        with: { days: 2, kcal: 1514.5, protein: 76.1, waterMl: 1250 },
        without: { days: 1, kcal: 790, protein: 49.4, waterMl: 0 },
      },
    });
  });
});
