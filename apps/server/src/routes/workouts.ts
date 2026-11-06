import type { WorkoutsResponse } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { HevyApi } from "../hevy/hevyApi.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { toWorkout } from "../parsers/hevy.js";
import { isValidDate } from "../services/dayView.js";

export interface WorkoutRoutesOptions {
  /** null when no Hevy API key is configured. */
  hevy: Pick<HevyApi, "workoutsSince"> | null;
  /** The Nutrition profile timezone decides the local date of a workout. */
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
}

/** Longest range one request may ask for. */
const MAX_DAYS = 62;

const dayDiff = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** Hevy workouts between two local dates: GET /api/workouts?from=YYYY-MM-DD&to=YYYY-MM-DD. */
export const workoutRoutes: FastifyPluginAsync<WorkoutRoutesOptions> = async (app, { hevy, api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get<{ Querystring: { from?: string; to?: string } }>("/workouts", async (request, reply): Promise<WorkoutsResponse | void> => {
    const { from, to } = request.query;
    if (!from || !to || !isValidDate(from) || !isValidDate(to) || to < from || dayDiff(from, to) > MAX_DAYS) {
      return reply.code(400).send({ error: "from and to must be YYYY-MM-DD, at most 62 days apart" });
    }
    if (!hevy) return { configured: false, workouts: [] };

    const { timezone } = await api.clock();
    // One day earlier in UTC covers every timezone offset; the local date filters exactly
    const since = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
    const workouts = (await hevy.workoutsSince(since))
      .map((workout) => toWorkout(workout, timezone))
      .filter((workout) => workout.date >= from && workout.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    return { configured: true, workouts };
  });
};
