import type { TrainingSourceId } from "@intake/shared";
import type { DatabaseSync } from "node:sqlite";
import { HevyError, type HevyApi } from "../hevy/hevyApi.js";
import { OpenGymError, type OpenGymApi } from "../opengym/openGymApi.js";
import type { HevyWorkout } from "../parsers/hevy.js";
import { openGymWorkouts, type OpenGymState, type OpenGymWorkout } from "../parsers/openGym.js";

/**
 * Where workouts come from: Hevy or openGym, one at a time (docs/opengym.md). Both are read live; openGym
 * workouts are mapped to the Hevy shape so the Timeline, the Health matching and the charts share one path.
 */
export type GymSource =
  | { id: "hevy"; label: "Hevy"; hevy: Pick<HevyApi, "workoutsSince" | "routines">; workoutsSince(since: string): Promise<HevyWorkout[]> }
  | { id: "opengym"; label: "openGym"; openGym: OpenGymApi; publicUrl: string; workoutsSince(since: string): Promise<HevyWorkout[]> };

/** Errors that mean "the gym app does not answer": the rest of the app keeps working. */
export const isGymUnavailable = (error: unknown) => error instanceof HevyError || error instanceof OpenGymError;

export function hevySource(hevy: Pick<HevyApi, "workoutsSince" | "routines">): GymSource {
  return { id: "hevy", label: "Hevy", hevy, workoutsSince: (since) => hevy.workoutsSince(since) };
}

/** A finished openGym workout with at least one done set, in the Hevy shape (exercise ids as template ids). */
export function fromOpenGym(workout: OpenGymWorkout, names: Map<string, string>, state: Pick<OpenGymState, "routines" | "customEx">): HevyWorkout {
  const routine = state.routines.find((r) => r.id === workout.routineId);
  const custom = state.customEx ?? {};
  return {
    id: workout.id,
    title: workout.name.trim() || routine?.name || "Allenamento",
    routine_id: workout.routineId ?? null,
    start_time: new Date(workout.start).toISOString(),
    end_time: new Date(workout.end).toISOString(),
    heart_rate:
      workout.hr && (workout.hr.avg || workout.hr.max)
        ? { avg: workout.hr.avg ? Math.round(workout.hr.avg) : null, max: workout.hr.max ? Math.round(workout.hr.max) : null }
        : null,
    exercises: workout.entries
      .map((e) => ({
        title: names.get(e.id) ?? custom[e.id]?.n ?? e.id,
        exercise_template_id: e.id,
        superset_id: null,
        sets: e.sets
          .filter((s) => s.done !== false)
          .map((s) => ({ type: s.phase === "warmup" ? "warmup" : "normal", weight_kg: s.w ?? null, reps: s.r ?? null, duration_seconds: null })),
      }))
      .filter((e) => e.sets.length > 0),
  };
}

/** Workouts with something done: an opened-and-closed session (no done set) is not a workout. */
const hasWork = (w: OpenGymWorkout) => w.entries.some((e) => e.sets.some((s) => s.done !== false));

export function openGymSource(openGym: OpenGymApi, publicUrl: string): GymSource {
  return {
    id: "opengym",
    label: "openGym",
    openGym,
    publicUrl,
    async workoutsSince(since) {
      const state = await openGym.state();
      const limit = Date.parse(since);
      const recent = openGymWorkouts(state).filter((w) => w.start >= limit && hasWork(w));
      const names = await Promise.all(recent.map((w) => openGym.exerciseNames(w.id).catch(() => new Map<string, string>())));
      return recent.map((w, i) => fromOpenGym(w, names[i]!, state));
    },
  };
}

const SETTINGS_KEY = "training_source";

/** The owner's choice, kept in the settings table; the active source falls back to what is configured. */
export class GymSources {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sources: Partial<Record<TrainingSourceId, GymSource>>,
  ) {}

  available(): TrainingSourceId[] {
    return (["hevy", "opengym"] as const).filter((id) => this.sources[id]);
  }

  preference(): TrainingSourceId | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    const value = row ? (JSON.parse(row.value) as unknown) : null;
    return value === "hevy" || value === "opengym" ? value : null;
  }

  /** The chosen source when configured, otherwise the first configured one (Hevy before openGym). */
  active(): GymSource | null {
    const preferred = this.preference();
    if (preferred && this.sources[preferred]) return this.sources[preferred]!;
    const first = this.available()[0];
    return first ? this.sources[first]! : null;
  }

  setPreference(id: TrainingSourceId): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(id));
  }
}
