import type { DayView } from "@intake/shared";
import type { NutritionApi } from "../mcp/nutritionApi.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Builds the Today view for a date ("today" resolves in the Nutrition profile's timezone).
 * Goals and totals come from structured content; meals come from the full meal listing.
 */
export async function getDayView(api: Pick<NutritionApi, "clock" | "goalProgress" | "mealsByDate">, requested: string): Promise<DayView> {
  const clock = await api.clock();
  const date = requested === "today" ? clock.localDate : requested;
  const [progress, meals] = await Promise.all([api.goalProgress(date), api.mealsByDate(date)]);

  return {
    date,
    isToday: date === clock.localDate,
    clock,
    goals: progress.goals,
    totals: progress.totals,
    meals: [...meals.meals].sort((a, b) => a.time.localeCompare(b.time)),
  };
}
