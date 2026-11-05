import { describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../src/mcp/connection.js";
import { NutritionApi, ToolError } from "../src/mcp/nutritionApi.js";
import { fixture } from "./parsers/fixtures.js";

const result = (text: string, isError = false): ToolResult => ({ text, structured: null, isError, raw: {} });

describe("NutritionApi", () => {
  it("requests full meal detail and returns parsed meals", async () => {
    const callTool = vi.fn(async () => result(fixture("meals-full-by-date.txt")));
    const meals = await new NutritionApi({ callTool }).mealsByDate("2026-11-04");
    expect(callTool).toHaveBeenCalledWith("get_meals_by_date", { date: "2026-11-04", detail: "full" });
    expect(meals.meals).toHaveLength(5);
  });

  it("throws ToolError on an error result", async () => {
    const api = new NutritionApi({ callTool: async () => result("Invalid date", true) });
    await expect(api.mealsByDate("bad")).rejects.toBeInstanceOf(ToolError);
  });

  it("reports parser warnings", async () => {
    const onWarnings = vi.fn();
    const api = new NutritionApi({ callTool: async () => result("- Calories: 2000 kcal\n- Potassium: 3500 mg") }, onWarnings);
    expect((await api.goals()).kcal).toBe(2000);
    expect(onWarnings).toHaveBeenCalledWith("get_nutrition_goals", ['goals: unknown goal "Potassium"']);
  });
});
