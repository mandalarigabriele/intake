import type { ProfileView } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";

export interface ProfileRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goals" | "weightTrends" | "logWeight">;
  hevyConfigured: boolean;
  requireOwner: preHandlerHookHandler;
}

/** Weigh-ins shown on Profilo (one a week: about 13 points). */
const WEIGHT_WINDOW_DAYS = 90;

const logWeightBody = z.object({
  weightKg: z.number().min(20).max(400),
  idempotencyKey: z.string().min(8).max(255),
});

/** Profilo (/api/profile) and weigh-ins (/api/weight). Two Nutrition reads per visit. */
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (app, { api, hevyConfigured, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/profile", async (): Promise<ProfileView> => {
    const today = (await api.clock()).localDate;
    const [goals, weight] = await Promise.all([api.goals(), api.weightTrends(WEIGHT_WINDOW_DAYS, today)]);
    return {
      today,
      weight,
      goals: { kcal: goals.kcal, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, fiber: goals.fiber, waterMl: goals.waterMl },
      hevyConfigured,
    };
  });

  app.post("/weight", async (request, reply) => {
    const body = logWeightBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid weight" });
    await api.logWeight(body.data.weightKg, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
