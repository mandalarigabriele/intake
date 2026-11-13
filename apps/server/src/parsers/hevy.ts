import type { Workout, WorkoutExercise } from "@intake/shared";
import { z } from "zod";

/**
 * Hevy public API (https://api.hevyapp.com/docs): GET /v1/workouts returns pages of workouts,
 * newest first. Fields not used here are ignored; times are UTC ISO strings.
 */
const setSchema = z.looseObject({
  type: z.string().default("normal"),
  weight_kg: z.number().nullable().optional(),
  reps: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
});

const exerciseSchema = z.looseObject({
  title: z.string(),
  sets: z.array(setSchema).default([]),
});

export const hevyWorkoutSchema = z.looseObject({
  id: z.string(),
  title: z.string().default(""),
  start_time: z.string(),
  end_time: z.string(),
  exercises: z.array(exerciseSchema).default([]),
});

export const hevyWorkoutPageSchema = z.looseObject({
  page: z.number(),
  page_count: z.number(),
  workouts: z.array(hevyWorkoutSchema),
});

export type HevyWorkout = z.infer<typeof hevyWorkoutSchema>;
export type HevyWorkoutPage = z.infer<typeof hevyWorkoutPageSchema>;

/** Local date (YYYY-MM-DD) and time (HH:MM) of an instant in a timezone. */
export function localDateTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const isWorking = (set: z.infer<typeof setSchema>) => set.type !== "warmup";

function toExercise(exercise: z.infer<typeof exerciseSchema>): WorkoutExercise {
  const working = exercise.sets.filter(isWorking);
  const weighted = working.filter((set) => (set.weight_kg ?? 0) > 0);
  const heaviest = weighted.reduce<(typeof weighted)[number] | null>(
    (top, set) => (top === null || set.weight_kg! > top.weight_kg! || (set.weight_kg === top.weight_kg && (set.reps ?? 0) > (top.reps ?? 0)) ? set : top),
    null,
  );
  return {
    title: exercise.title,
    workingSets: working.length,
    best: heaviest ? { weightKg: heaviest.weight_kg!, reps: heaviest.reps ?? null } : null,
    durationSeconds: working.reduce((sum, set) => sum + (set.duration_seconds ?? 0), 0),
  };
}

/** The part of a Workout that comes from Hevy alone. */
export type HevyWorkoutSummary = Pick<Workout, "id" | "title" | "date" | "start" | "end" | "durationMinutes" | "exercises" | "sets" | "volumeKg">;

/** A Hevy workout in the profile timezone, with its exercises summarized. */
export function toWorkout(workout: HevyWorkout, timeZone: string): HevyWorkoutSummary {
  const start = localDateTime(workout.start_time, timeZone);
  const end = localDateTime(workout.end_time, timeZone);
  const sets = workout.exercises.flatMap((exercise) => exercise.sets.filter(isWorking));
  return {
    id: workout.id,
    title: workout.title.trim() || "Allenamento",
    date: start.date,
    start: start.time,
    end: end.time,
    durationMinutes: Math.max(0, Math.round((Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 60_000)),
    exercises: workout.exercises.map(toExercise),
    sets: sets.length,
    volumeKg: Math.round(sets.reduce((sum, set) => sum + (set.weight_kg ?? 0) * (set.reps ?? 0), 0)),
  };
}
