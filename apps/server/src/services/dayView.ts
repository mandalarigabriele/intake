import type { DayView } from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { planComparison, plannedEntries } from "./planMatching.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export type DayApi = Pick<NutritionApi, "clock" | "goalProgress" | "mealsByDate">;
export type DayPlans = Pick<PlanStore, "activeOn" | "linksOn" | "skipsOn">;

/**
 * Builds the Today view for a date ("today" resolves in the Nutrition profile's timezone).
 * Goals and totals come from structured content, meals from the full meal listing,
 * planned meals from the plan in effect on that date.
 */
export async function getDayView(api: DayApi, plans: DayPlans | null, requested: string): Promise<DayView> {
  const clock = await api.clock();
  const date = requested === "today" ? clock.localDate : requested;
  const [progress, parsed] = await Promise.all([api.goalProgress(date), api.mealsByDate(date)]);
  const meals = [...parsed.meals].sort((a, b) => a.time.localeCompare(b.time));

  const activePlan = plans ? plans.activeOn(date) : null;
  const context = { date, today: clock.localDate, now: clock.localTime };
  const links = plans ? plans.linksOn(date) : [];
  const skips = plans ? plans.skipsOn(date) : [];
  const planned = plans ? plannedEntries(activePlan, meals, links, context, skips) : [];
  const comparison = plans ? planComparison(activePlan, meals, links, context, skips) : null;

  return {
    date,
    isToday: date === clock.localDate,
    clock,
    goals: progress.goals,
    totals: progress.totals,
    meals,
    planned,
    hasPlan: activePlan !== null,
    comparison,
  };
}
