import type { InsightResponse } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { WINDOW_DAYS, pickInsight } from "../services/insight.js";

export interface InsightRoutesOptions {
  api: Pick<NutritionApi, "clock" | "mealPatterns" | "mealsByRange" | "summary" | "goals">;
  requireOwner: preHandlerHookHandler;
  now?: () => number;
}

const CACHE_MS = 60 * 60 * 1000;

function shiftDate(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/insight: the daily "Dai tuoi dati" sentence. It costs four Nutrition requests, so the
 * result is kept in memory for an hour (per date) to stay well within the 60 requests per minute.
 */
export const insightRoutes: FastifyPluginAsync<InsightRoutesOptions> = async (app, { api, requireOwner, now = Date.now }) => {
  app.addHook("preHandler", requireOwner);
  const cache = new Map<string, { expires: number; value: InsightResponse }>();

  app.get("/insight", async (): Promise<InsightResponse> => {
    const today = (await api.clock()).localDate;
    const cached = cache.get(today);
    if (cached && cached.expires > now()) return cached.value;

    const start = shiftDate(today, -(WINDOW_DAYS - 1));
    const [patterns, range, summary, goals] = await Promise.all([
      api.mealPatterns(WINDOW_DAYS, today),
      api.mealsByRange(start, today),
      api.summary(start, today),
      api.goals(),
    ]);
    const value: InsightResponse = { insight: pickInsight({ today, patterns, meals: range.meals, summary, proteinGoal: goals.protein }) };
    cache.clear();
    cache.set(today, { expires: now() + CACHE_MS, value });
    return value;
  });
};
