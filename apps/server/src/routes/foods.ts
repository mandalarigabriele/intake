import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";

export interface FoodRoutesOptions {
  api: Pick<NutritionApi, "searchFoods" | "foodMacros">;
  requireOwner: preHandlerHookHandler;
}

const searchSchema = z.object({ q: z.string().trim().min(1).max(100) });
const macrosSchema = z.object({ amount: z.coerce.number().gt(0).max(5000) });

/**
 * "Cerca nel database" in the dish editor: USDA generic foods through the Nutrition server. No Claude request and no
 * stored data; each answer is kept in memory 30 seconds by NutritionApi, and the 60 requests a minute are shared with
 * the rest of the app, so the web app searches only when asked. docs/plan-generation.md
 */
export const foodRoutes: FastifyPluginAsync<FoodRoutesOptions> = async (app, { api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/foods/search", async (request, reply) => {
    const query = searchSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    return { foods: await api.searchFoods(query.data.q) };
  });

  app.get<{ Params: { id: string } }>("/foods/:id", async (request, reply) => {
    const query = macrosSchema.safeParse(request.query);
    const id = Number(request.params.id);
    if (!query.success || !Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid_request" });
    return api.foodMacros(id, query.data.amount);
  });
};
