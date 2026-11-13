import type { TrainingView } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { HealthStore } from "../db/healthStore.js";
import { HevyError, type HevyApi } from "../hevy/hevyApi.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { mergeWorkouts } from "../services/healthWorkouts.js";
import { buildTraining } from "../services/training.js";

export interface TrainingRoutesOptions {
  hevy: Pick<HevyApi, "routines" | "workoutsSince"> | null;
  health?: Pick<HealthStore, "workouts">;
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
}

/** History for the load charts and the rotation: about four months of workouts (Hevy pages are cached for 5 minutes). */
const HISTORY_DAYS = 120;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** GET /api/training: Andamento › Allenamenti, read live from Hevy (docs/design § Allenamenti). */
export const trainingRoutes: FastifyPluginAsync<TrainingRoutesOptions> = async (app, { hevy, health, api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/training", async (request): Promise<TrainingView> => {
    const clock = await api.clock();
    const today = clock.localDate;
    const empty: TrainingView = {
      configured: hevy !== null,
      today,
      next: null,
      week: { start: today, days: [], done: 0, total: 0, minutes: 0, exercises: 0, other: [] },
      lifts: [],
      recent: [],
    };
    if (!hevy) return empty;
    const from = addDays(today, -HISTORY_DAYS);
    let routines, workouts;
    try {
      [routines, workouts] = await Promise.all([hevy.routines(), hevy.workoutsSince(`${from}T00:00:00Z`)]);
    } catch (error) {
      if (!(error instanceof HevyError)) throw error;
      request.log.warn({ err: error.message }, "Hevy unavailable for the training view");
      return { ...empty, hevyUnavailable: true };
    }
    const sessions = health ? mergeWorkouts(health.workouts(addDays(today, -14), today)) : [];
    return buildTraining({ routines, workouts, health: sessions, timeZone: clock.timezone, today });
  });
};
