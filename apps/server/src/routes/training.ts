import type { TrainingSourceStatus, TrainingView } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { HealthStore } from "../db/healthStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isGymUnavailable, type GymSource } from "../services/gymSource.js";
import { mergeWorkouts } from "../services/healthWorkouts.js";
import { buildOpenGymTraining, healthCoveredRoutines, nextPlannedDate } from "../services/openGymTraining.js";
import { buildTraining } from "../services/training.js";

export interface TrainingRoutesOptions {
  /** The active workout source, or null when none is configured. */
  gym: () => GymSource | null;
  /** Configured sources and the owner's choice; without it the source cannot be changed. */
  sources?: { available(): Array<"hevy" | "opengym">; setPreference(id: "hevy" | "opengym"): void };
  health?: Pick<HealthStore, "workouts">;
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
}

/** History for the load charts and the rotation: about four months of workouts (pages are cached briefly). */
const HISTORY_DAYS = 120;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sourceBody = z.object({ source: z.enum(["hevy", "opengym"]) });

/** GET /api/training (Andamento › Allenamenti) and the workout source switch (docs/opengym.md). */
export const trainingRoutes: FastifyPluginAsync<TrainingRoutesOptions> = async (app, { gym, sources, health, api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  const status = (): TrainingSourceStatus => ({ available: sources?.available() ?? (gym() ? [gym()!.id] : []), active: gym()?.id ?? null });

  app.get("/training/source", async (): Promise<TrainingSourceStatus> => status());

  app.put("/training/source", async (request, reply): Promise<TrainingSourceStatus | void> => {
    const body = sourceBody.safeParse(request.body);
    if (!body.success || !sources) return reply.code(400).send({ error: "source must be hevy or opengym" });
    if (!sources.available().includes(body.data.source)) return reply.code(409).send({ error: "source_not_configured" });
    sources.setPreference(body.data.source);
    return status();
  });

  app.get("/training", async (request): Promise<TrainingView> => {
    const clock = await api.clock();
    const today = clock.localDate;
    const source = gym();
    const empty: TrainingView = {
      configured: source !== null,
      today,
      source: source ? { id: source.id, label: source.label, openUrl: source.id === "opengym" ? source.publicUrl : null } : null,
      next: null,
      week: { start: today, days: [], done: 0, total: 0, minutes: 0, exercises: 0, other: [] },
      lifts: [],
      recent: [],
    };
    if (!source) return empty;
    const since = `${addDays(today, -HISTORY_DAYS)}T00:00:00Z`;
    const sessions = health ? mergeWorkouts(health.workouts(addDays(today, -14), today)) : [];
    try {
      if (source.id === "hevy") {
        const [routines, workouts] = await Promise.all([source.hevy.routines(), source.workoutsSince(since)]);
        return buildTraining({ routines, workouts, health: sessions, timeZone: clock.timezone, today });
      }
      const [state, plan, workouts] = await Promise.all([source.openGym.state(), source.openGym.weekPlan(), source.workoutsSince(since)]);
      const routineNames = await source.openGym.routineExerciseNames(state.routines.map((r) => r.id));
      const date = nextPlannedDate(plan, workouts, clock.timezone, healthCoveredRoutines(state, sessions, today, routineNames));
      // Optional parts: the view still works if one of them fails
      const [preview, muscles] = await Promise.all([
        date ? source.openGym.preview(date).catch(() => null) : Promise.resolve(null),
        source.openGym.muscleBalance().catch(() => null),
      ]);
      return buildOpenGymTraining({ state, plan, preview, muscles, routineNames, workouts, health: sessions, timeZone: clock.timezone, today, openUrl: source.publicUrl });
    } catch (error) {
      if (!isGymUnavailable(error)) throw error;
      request.log.warn({ err: (error as Error).message }, `${source.label} unavailable for the training view`);
      return { ...empty, hevyUnavailable: true };
    }
  });
};
