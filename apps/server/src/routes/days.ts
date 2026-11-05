import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { getDayView, isValidDate } from "../services/dayView.js";

export interface DayRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goalProgress" | "mealsByDate" | "addWater">;
  requireOwner: preHandlerHookHandler;
}

const addWaterBody = z.object({
  amountMl: z.number().int().positive().max(5000),
  idempotencyKey: z.string().min(8).max(255),
});

/** Day data under /api. */
export const dayRoutes: FastifyPluginAsync<DayRoutesOptions> = async (app, { api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Params: { date: string } }>("/days/:date", async (request, reply) => {
    const { date } = request.params;
    if (date !== "today" && !isValidDate(date)) {
      return reply.code(400).send({ error: "Date must be YYYY-MM-DD or 'today'" });
    }
    return getDayView(api, date);
  });

  app.post("/water", async (request, reply) => {
    const body = addWaterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid water amount" });
    await api.addWater(body.data.amountMl, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
