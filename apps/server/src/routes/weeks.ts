import type { WeekView } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isValidDate } from "../services/dayView.js";

export interface WeekRoutesOptions {
  api: Pick<NutritionApi, "clock" | "summary" | "weightTrends" | "logWeight">;
  requireOwner: preHandlerHookHandler;
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
export const weekRoutes: FastifyPluginAsync<WeekRoutesOptions> = async (app, { api, requireOwner }) => {
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

    const [summary, weight] = await Promise.all([
      start <= today ? api.summary(start, summaryEnd) : Promise.resolve({ goals: { kcal: null, protein: null }, days: [] }),
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
    const logged = days.filter((d) => d.kcal !== null);
    const averages =
      logged.length > 0
        ? {
            kcal: logged.reduce((sum, d) => sum + d.kcal!, 0) / logged.length,
            protein: logged.reduce((sum, d) => sum + d.protein!, 0) / logged.length,
            days: logged.length,
          }
        : null;

    return { start, end, today, goals: summary.goals, days, averages, weight };
  });

  app.post("/weight", async (request, reply) => {
    const body = logWeightBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid weight" });
    await api.logWeight(body.data.weightKg, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
