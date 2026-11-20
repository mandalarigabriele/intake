import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../src/mcp/connection.js";
import { rateLimitFrom } from "../src/mcp/connection.js";
import { NutritionApi, ToolError, clockIn } from "../src/mcp/nutritionApi.js";
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

  it("sends only the changed goals to set_nutrition_goals, with the target weight in kg", async () => {
    const callTool = vi.fn(async () => result("Goals saved"));
    const api = new NutritionApi({ callTool });
    await api.setGoals({ kcal: 2100, fiber: null, waterMl: 2000, targetWeight: 72.5, weightUnit: "kg" });
    expect(callTool).toHaveBeenCalledWith("set_nutrition_goals", { daily_calories: 2100, daily_fiber_g: null, daily_water_ml: 2000, target_weight: 72.5, unit: "kg" });
    await api.setGoals({});
    expect(callTool).toHaveBeenCalledTimes(1);
    await api.setGoals({ targetWeight: 160, weightUnit: "lb" });
    expect(callTool).toHaveBeenLastCalledWith("set_nutrition_goals", { target_weight: 160, unit: "lb" });
  });
});

describe("NutritionApi export", () => {
  it("asks for a new export every time (never from the read cache) and returns its link", async () => {
    const text = readFileSync(new URL("../src/parsers/__fixtures__/export-all-data.txt", import.meta.url), "utf8");
    const callTool = vi.fn(async () => result(text));
    const api = new NutritionApi({ callTool });
    expect((await api.exportAllData()).url).toMatch(/^https:\/\/exampleproject\.supabase\.co\//);
    await api.exportAllData();
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenCalledWith("export_all_data", {});
  });
});

describe("NutritionApi request budget (60 requests per minute on the Nutrition server)", () => {
  const goals = () => result("- Calories: 2000 kcal");
  const clockText = "Local time now: Thursday 2026-11-05 10:02:10 (Europe/Rome). UTC now: 2026-11-05T09:02:10.540Z.";

  it("answers identical reads from memory for 30 seconds, then asks again", async () => {
    let now = new Date("2026-11-05T09:00:00Z");
    const callTool = vi.fn(async () => goals());
    const api = new NutritionApi({ callTool }, undefined, { now: () => now });
    await api.goals();
    await api.goals();
    expect(callTool).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 31_000);
    await api.goals();
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent identical reads", async () => {
    const callTool = vi.fn(async () => goals());
    const api = new NutritionApi({ callTool });
    await Promise.all([api.goals(), api.goals(), api.goals()]);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const callTool = vi.fn().mockResolvedValueOnce(result("boom", true)).mockResolvedValue(goals());
    const api = new NutritionApi({ callTool });
    await expect(api.goals()).rejects.toBeInstanceOf(ToolError);
    expect((await api.goals()).kcal).toBe(2000);
  });

  it("clears the cache on every write", async () => {
    const callTool = vi.fn(async (tool: string) => (tool === "log_water" ? result("ok") : goals()));
    const api = new NutritionApi({ callTool });
    await api.goals();
    await api.addWater(250, "key-123456");
    await api.goals();
    expect(callTool.mock.calls.map((c) => c[0])).toEqual(["get_nutrition_goals", "log_water", "get_nutrition_goals"]);
  });

  it("computes the clock locally from the timezone, refreshing it after an hour", async () => {
    let now = new Date("2026-11-05T09:02:10Z");
    const callTool = vi.fn(async () => result(clockText));
    const api = new NutritionApi({ callTool }, undefined, { now: () => now });
    await api.clock();
    now = new Date("2026-11-05T09:40:00Z");
    expect(await api.clock()).toEqual({ timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "10:40:00", utc: "2026-11-05T09:40:00.000Z" });
    expect(callTool).toHaveBeenCalledTimes(1);
    now = new Date("2026-11-05T10:10:00Z");
    await api.clock();
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("handles the date change at midnight in the profile timezone", () => {
    expect(clockIn("Europe/Rome", new Date("2026-11-05T23:30:00Z"))).toMatchObject({ localDate: "2026-11-06", localTime: "00:30:00" });
    expect(clockIn("America/New_York", new Date("2026-11-06T03:30:00Z"))).toMatchObject({ localDate: "2026-11-05", localTime: "22:30:00" });
  });
});

describe("rateLimitFrom", () => {
  it("recognizes the Nutrition rate limit error and its retry delay", () => {
    const error = new Error(
      'Streamable HTTP error: Error POSTing to endpoint: {"error":"rate_limited","error_description":"Rate limit exceeded (60 requests per minute). Retry after 33s."}',
    );
    expect(rateLimitFrom(error)).toMatchObject({ name: "RateLimitedError", retryAfterSeconds: 33 });
    expect(rateLimitFrom(new Error("Connection closed"))).toBeNull();
  });
});
