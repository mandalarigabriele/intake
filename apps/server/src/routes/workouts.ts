import type { WorkoutsResponse } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { HealthStore } from "../db/healthStore.js";
import { HevyError, type HevyApi } from "../hevy/hevyApi.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import type { HevyWorkout } from "../parsers/hevy.js";
import { localDateTime } from "../parsers/hevy.js";
import { isValidDate } from "../services/dayView.js";
import { combineWorkouts } from "../services/dayWorkouts.js";
import { mergeWorkouts } from "../services/healthWorkouts.js";

export interface WorkoutRoutesOptions {
  /** null when no Hevy API key is configured. */
  hevy: Pick<HevyApi, "workoutsSince"> | null;
  /** Apple Health workouts stored from Health Auto Export; omitted in tests that only cover Hevy. */
  health?: Pick<HealthStore, "workouts">;
  /** The Nutrition profile timezone decides the local date of a workout. */
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
}

/** Longest range one request may ask for. */
const MAX_DAYS = 62;

const dayDiff = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * Workouts between two local dates: GET /api/workouts?from=YYYY-MM-DD&to=YYYY-MM-DD.
 * Hevy workouts (read live) and Apple Health sessions, each session once.
 */
export const workoutRoutes: FastifyPluginAsync<WorkoutRoutesOptions> = async (app, { hevy, health, api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Querystring: { from?: string; to?: string } }>("/workouts", async (request, reply): Promise<WorkoutsResponse | void> => {
    const { from, to } = request.query;
    if (!from || !to || !isValidDate(from) || !isValidDate(to) || to < from || dayDiff(from, to) > MAX_DAYS) {
      return reply.code(400).send({ error: "from and to must be YYYY-MM-DD, at most 62 days apart" });
    }

    const { timezone } = await api.clock();
    let hevyWorkouts: HevyWorkout[] = [];
    let hevyUnavailable = false;
    if (hevy) {
      // One day earlier in UTC covers every timezone offset; the local date filters exactly
      const since = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
      try {
        hevyWorkouts = (await hevy.workoutsSince(since)).filter((w) => {
          const date = localDateTime(w.start_time, timezone).date;
          return date >= from && date <= to;
        });
      } catch (error) {
        // Without Health data there is nothing else to show: keep the 502 from the error handler
        if (!(error instanceof HevyError) || !health) throw error;
        request.log.warn({ err: error }, "Hevy unavailable, listing Apple Health workouts only");
        hevyUnavailable = true;
      }
    }
    const sessions = health ? mergeWorkouts(health.workouts(from, to)) : [];
    const workouts = combineWorkouts(hevyWorkouts, sessions, timezone);
    return { configured: hevy !== null, ...(hevyUnavailable ? { hevyUnavailable } : {}), workouts };
  });
};
