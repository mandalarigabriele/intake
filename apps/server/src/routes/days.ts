import { isFixedMeal, planDay } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { getDayView, isValidDate } from "../services/dayView.js";
import { logPlannedMeal, PlanMealNotFoundError, PlanMealWithoutMacrosError } from "../services/logPlanned.js";

export interface DayRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goalProgress" | "mealsByDate" | "addWater" | "logMeal">;
  plans?: Pick<PlanStore, "activeOn" | "linksOn" | "skipsOn" | "get" | "addLink" | "addSkip" | "removeSkip">;
  requireOwner: preHandlerHookHandler;
}

const addWaterBody = z.object({
  amountMl: z.number().int().positive().max(5000),
  idempotencyKey: z.string().min(8).max(255),
});

/** Day data under /api. */
export const dayRoutes: FastifyPluginAsync<DayRoutesOptions> = async (app, { api, plans, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Params: { date: string } }>("/days/:date", async (request, reply) => {
    const { date } = request.params;
    if (date !== "today" && !isValidDate(date)) {
      return reply.code(400).send({ error: "Date must be YYYY-MM-DD or 'today'" });
    }
    return getDayView(api, plans ?? null, date);
  });

  // "Mangiato come previsto": log a planned meal of the given day
  app.post<{ Params: { date: string; planId: string; index: string } }>(
    "/days/:date/planned/:planId/:index",
    async (request, reply) => {
      const { date } = request.params;
      const planId = Number(request.params.planId);
      const index = Number(request.params.index);
      if (!plans || !isValidDate(date) || !Number.isInteger(planId) || !Number.isInteger(index) || index < 0) {
        return reply.code(400).send({ error: "Invalid planned meal" });
      }
      const clock = await api.clock();
      try {
        const result = await logPlannedMeal(api, plans, { date, planId, index, today: clock.localDate, now: clock.localTime });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof PlanMealNotFoundError) return reply.code(404).send({ error: error.message });
        if (error instanceof PlanMealWithoutMacrosError) return reply.code(422).send({ error: "missing_macros" });
        throw error;
      }
    },
  );

  // "Salta" / "Annulla": skip a planned meal of the given day, or restore it
  for (const method of ["POST", "DELETE"] as const) {
    app.route<{ Params: { date: string; planId: string; index: string } }>({
      method,
      url: "/days/:date/planned/:planId/:index/skip",
      handler: async (request, reply) => {
        const { date } = request.params;
        const planId = Number(request.params.planId);
        const index = Number(request.params.index);
        if (!plans || !isValidDate(date) || !Number.isInteger(planId) || !Number.isInteger(index) || index < 0) {
          return reply.code(400).send({ error: "Invalid planned meal" });
        }
        const meal = plans.get(planId) && planDay(plans.get(planId)!.plan, date).meals[index];
        if (!meal || !isFixedMeal(meal)) return reply.code(404).send({ error: "Planned meal not found" });
        if (method === "POST") plans.addSkip(date, planId, index);
        else plans.removeSkip(date, planId, index);
        return { skipped: method === "POST" };
      },
    });
  }

  app.post("/water", async (request, reply) => {
    const body = addWaterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid water amount" });
    await api.addWater(body.data.amountMl, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
