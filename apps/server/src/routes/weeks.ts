import type { TargetDays, WeekConsistency, WeekView } from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionSummary } from "../parsers/summary.js";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isValidDate } from "../services/dayView.js";

export interface WeekRoutesOptions {
  api: Pick<NutritionApi, "clock" | "summary" | "weightTrends" | "logWeight">;
  plans?: Pick<PlanStore, "linkCountBetween" | "skipCountBetween">;
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

const WEIGHT_WINDOW_DAYS = 90;

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

const logWeightBody = z.object({
  weightKg: z.number().min(20).max(400),
  idempotencyKey: z.string().min(8).max(255),
});

/** Week overview (/api/weeks/:date) and weigh-ins (/api/weight). */
export const weekRoutes: FastifyPluginAsync<WeekRoutesOptions> = async (app, { api, plans, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Params: { date: string } }>("/weeks/:date", async (request, reply): Promise<WeekView | void> => {
    const today = (await api.clock()).localDate;
    const requested = request.params.date === "current" ? today : request.params.date;
    if (!isValidDate(requested)) return reply.code(400).send({ error: "Date must be YYYY-MM-DD or 'current'" });

    const start = mondayOf(requested);
    const end = shiftDate(start, 6);
    // Nothing can be logged after today: ask for the summary up to today at most
    const summaryEnd = end < today ? end : today;
    const weightEnd = summaryEnd;

    // One summary request covers the week and the streak lookback before it
    const lookbackStart = shiftDate(start, -STREAK_LOOKBACK_DAYS);
    const [summary, weight] = await Promise.all([
      start <= today ? api.summary(lookbackStart, summaryEnd) : Promise.resolve<NutritionSummary>({ goals: { kcal: null, protein: null, waterMl: null }, days: [] }),
      api.weightTrends(WEIGHT_WINDOW_DAYS, weightEnd),
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
    const logged = days.filter((d) => d.kcal !== null && d.date < today);
    const averages =
      logged.length > 0
        ? {
            kcal: logged.reduce((sum, d) => sum + d.kcal!, 0) / logged.length,
            protein: logged.reduce((sum, d) => sum + d.protein!, 0) / logged.length,
            days: logged.length,
          }
        : null;

    const completed = summary.days.filter((d) => d.date >= start && d.date <= end && d.date < today && d.mealCount > 0);
    const consistency: WeekConsistency = {
      streak: loggingStreak(summary.days, today),
      protein: targetDays(completed, (d) => d.protein, summary.goals.protein),
      water: targetDays(completed, (d) => d.waterMl, summary.goals.waterMl),
      asPlanned: plans ? plans.linkCountBetween(start, end) : 0,
      skipped: plans ? plans.skipCountBetween(start, end) : 0,
    };

    return { start, end, today, goals: { kcal: summary.goals.kcal, protein: summary.goals.protein }, days, averages, consistency, weight };
  });

  app.post("/weight", async (request, reply) => {
    const body = logWeightBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid weight" });
    await api.logWeight(body.data.weightKg, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
