import type { Meal, MealDeviation, TargetDays, WeekAverages, WeekConsistency, WeekPlanComparison, WeekView } from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionSummary } from "../parsers/summary.js";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isValidDate } from "../services/dayView.js";
import { planComparison } from "../services/planMatching.js";

export interface WeekRoutesOptions {
  /** mealsByRange is needed for "Piano e realtà"; without it the week has no plan comparison. */
  api: Pick<NutritionApi, "clock" | "summary"> & Partial<Pick<NutritionApi, "mealsByRange">>;
  plans?: Pick<PlanStore, "linkCountBetween" | "skipCountBetween" | "activeOn" | "linksOn" | "skipsOn">;
  requireOwner: preHandlerHookHandler;
}

/** How far back the logging streak is looked for (one summary request covers it). */
const STREAK_LOOKBACK_DAYS = 28;

type SummaryDay = NutritionSummary["days"][number];

function targetDays(days: SummaryDay[], value: (d: SummaryDay) => number, goal: number | null): TargetDays {
  const best = days.reduce<SummaryDay | null>((top, d) => (top === null || value(d) > value(top) ? d : top), null);
  return {
    hit: goal ? days.filter((d) => value(d) >= goal).length : 0,
    total: days.length,
    best: best ? { date: best.date, value: value(best) } : null,
    goal,
  };
}

/** Share of the macro calories as whole percentages that add up to 100 (largest remainder). */
export function kcalShare(protein: number, carbs: number, fat: number): WeekAverages["kcalShare"] {
  const kcal = [protein * 4, carbs * 4, fat * 9];
  const total = kcal.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const exact = kcal.map((k) => (k / total) * 100);
  const whole = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - whole[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - whole.reduce((a, b) => a + b, 0);
  for (let i = 0; i < missing; i++) whole[order[i]![1]]! += 1;
  return { protein: whole[0]!, carbs: whole[1]!, fat: whole[2]! };
}

/** Consecutive logged days ending today (if today already has meals) or yesterday. */
export function loggingStreak(days: SummaryDay[], today: string): string[] {
  const logged = new Set(days.filter((d) => d.mealCount > 0).map((d) => d.date));
  const streak: string[] = [];
  let cursor = logged.has(today) ? today : shiftDate(today, -1);
  while (logged.has(cursor)) {
    streak.unshift(cursor);
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

/** Plan against logged meals for the days of a week up to today. */
export function weekPlanComparison(
  dates: string[],
  clock: { localDate: string; localTime: string },
  plans: NonNullable<WeekRoutesOptions["plans"]>,
  meals: Meal[],
): WeekPlanComparison | null {
  const days: WeekPlanComparison["days"] = [];
  const deviations: MealDeviation[] = [];
  let anyPlan = false;
  for (const date of dates) {
    if (date > clock.localDate) break;
    const dayMeals = meals.filter((meal) => meal.date === date);
    const comparison = planComparison(plans.activeOn(date), dayMeals, plans.linksOn(date), { date, today: clock.localDate, now: clock.localTime }, plans.skipsOn(date));
    if (!comparison?.plannedDay) continue;
    anyPlan = true;
    for (const meal of comparison.meals) {
      if (meal.status === "eaten" && meal.planned && meal.logged) {
        deviations.push({ date, title: meal.title, time: meal.time, planned: meal.planned.kcal, logged: meal.logged.kcal });
      }
    }
    if (date < clock.localDate && dayMeals.length > 0) {
      const eaten = dayMeals.reduce((sum, meal) => sum + meal.nutrients.kcal, 0);
      days.push({ date, planned: comparison.plannedDay.kcal, eaten, hasFreeMeal: comparison.hasFreeMeal });
    }
  }
  if (!anyPlan) return null;
  const full = days.filter((d) => !d.hasFreeMeal);
  return {
    days,
    averageDiff: full.length > 0 ? full.reduce((sum, d) => sum + d.eaten - d.planned, 0) / full.length : null,
    deviations: deviations
      .filter((d) => Math.abs(d.logged - d.planned) >= 1)
      .sort((a, b) => Math.abs(b.logged - b.planned) - Math.abs(a.logged - a.planned))
      .slice(0, 3),
  };
}

function shiftDate(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}

/** Week overview (/api/weeks/:date) for Andamento › Alimentazione. */
export const weekRoutes: FastifyPluginAsync<WeekRoutesOptions> = async (app, { api, plans, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Params: { date: string } }>("/weeks/:date", async (request, reply): Promise<WeekView | void> => {
    const clock = await api.clock();
    const today = clock.localDate;
    const requested = request.params.date === "current" ? today : request.params.date;
    if (!isValidDate(requested)) return reply.code(400).send({ error: "Date must be YYYY-MM-DD or 'current'" });

    const start = mondayOf(requested);
    const end = shiftDate(start, 6);
    // Nothing can be logged after today: ask for the summary up to today at most
    const summaryEnd = end < today ? end : today;

    // One summary request covers the week and the streak lookback before it
    const lookbackStart = shiftDate(start, -STREAK_LOOKBACK_DAYS);
    const withPlan = plans && api.mealsByRange && start <= today;
    const [summary, weekMeals] = await Promise.all([
      start <= today ? api.summary(lookbackStart, summaryEnd) : Promise.resolve<NutritionSummary>({ goals: { kcal: null, protein: null, fiber: null, waterMl: null }, days: [] }),
      withPlan ? api.mealsByRange!(start, summaryEnd) : Promise.resolve(null),
    ]);

    const byDate = new Map(summary.days.map((d) => [d.date, d]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(start, i);
      const day = byDate.get(date);
      return day && day.mealCount > 0
        ? { date, kcal: day.kcal, protein: day.protein, mealCount: day.mealCount }
        : { date, kcal: null, protein: null, mealCount: 0 };
    });
    // Averages and targets use completed days only: today counts once it is over
    const completed = summary.days.filter((d) => d.date >= start && d.date <= end && d.date < today && d.mealCount > 0);
    const withFiber = completed.filter((d) => d.fiber !== null);
    const mean = (list: SummaryDay[], value: (d: SummaryDay) => number) => list.reduce((sum, d) => sum + value(d), 0) / list.length;
    const averages =
      completed.length > 0
        ? {
            kcal: mean(completed, (d) => d.kcal),
            protein: mean(completed, (d) => d.protein),
            fiber: withFiber.length > 0 ? mean(withFiber, (d) => d.fiber!) : null,
            waterMl: mean(completed, (d) => d.waterMl),
            days: completed.length,
            kcalShare: kcalShare(mean(completed, (d) => d.protein), mean(completed, (d) => d.carbs), mean(completed, (d) => d.fat)),
          }
        : null;

    const soFar = days.filter((d) => d.date <= today);
    const consistency: WeekConsistency = {
      streak: loggingStreak(summary.days, today),
      logged: { days: soFar.filter((d) => d.kcal !== null).map((d) => d.date), total: soFar.length },
      protein: targetDays(completed, (d) => d.protein, summary.goals.protein),
      fiber: targetDays(withFiber, (d) => d.fiber!, summary.goals.fiber),
      water: targetDays(completed, (d) => d.waterMl, summary.goals.waterMl),
      asPlanned: plans ? plans.linkCountBetween(start, end) : 0,
      skipped: plans ? plans.skipCountBetween(start, end) : 0,
    };

    const plan = plans && weekMeals ? weekPlanComparison(days.map((d) => d.date), clock, plans, weekMeals.meals) : null;

    return { start, end, today, goals: summary.goals, days, averages, consistency, plan };
  });
};
