import { describe, expect, it } from "vitest";
import { parseFoodMacros, parseFoodSearch } from "../../src/parsers/foods.js";
import { fixture } from "./fixtures.js";

describe("parseFoodSearch", () => {
  it("reads the candidates of a real search_foods answer, with commas and parentheses in the description", () => {
    const { value, warnings } = parseFoodSearch(fixture("food-search.txt"));
    expect(warnings).toEqual([]);
    expect(value).toHaveLength(5);
    expect(value[0]).toEqual({ id: 168916, description: "Pasta, whole grain, 51% whole wheat, remaining unenriched semolina, cooked", kcal: 159, protein: 5.82, carbs: 31.5, fat: 1.5 });
    expect(value[3]).toMatchObject({ id: 168910, description: "Pasta, whole-wheat, cooked (Includes foods for USDA's Food Distribution Program)", kcal: 149 });
  });

  it("returns an empty list for an answer without foods and warns about a line it cannot read", () => {
    expect(parseFoodSearch("No foods found.").value).toEqual([]);
    const { value, warnings } = parseFoodSearch("1 · Thing · SR Legacy · calories many kcal · protein 1 g · carbs 1 g · fat 1 g");
    expect(value).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe("parseFoodMacros", () => {
  it("reads the values for the requested amount of a real get_food_macros answer", () => {
    const { value, warnings } = parseFoodMacros(fixture("food-macros.txt"), 150);
    expect(warnings).toEqual([]);
    expect(value).toMatchObject({ id: 168910, name: "Pasta, whole-wheat, cooked (Includes foods for USDA's Food Distribution Program)", amountG: 150 });
    expect(value.values).toEqual({ kcal: 224, protein: 8.99, carbs: 45.11, fat: 2.57, fiber: 5.85, sugar: 1.13 });
  });

  it("scales the per 100 g values when there is no amount line, and keeps a nutrient USDA does not record as null", () => {
    const text = fixture("food-macros.txt")
      .split("\n")
      .filter((l) => !l.startsWith("For "))
      .join("\n")
      .replace(" · fiber 3.9 g", "");
    const { value } = parseFoodMacros(text, 200);
    expect(value.values.kcal).toBeCloseTo(298);
    expect(value.values.fiber).toBeNull();
  });

  it("refuses an answer it cannot read", () => {
    expect(() => parseFoodMacros("Food not found.", 100)).toThrow(/not understood/);
  });
});
