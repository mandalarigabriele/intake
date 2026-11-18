import { z } from "zod";

/**
 * openGym (self-hosted gym tracker, https://opengym.ch/api.html). Two read paths with one scoped token:
 * the raw app state (GET /api/token/data) for workout times, and the MCP tools for what openGym computes
 * (week plan, the session a routine opens with after progression, muscle balance). Only used fields are validated.
 */

const setSchema = z.looseObject({
  w: z.number().nullable().optional(),
  r: z.number().nullable().optional(),
  done: z.boolean().optional(),
  phase: z.string().optional(),
  rpe: z.number().nullable().optional(),
  /** Cardio sets: minutes and average speed (km/h). */
  min: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
});

export const openGymWorkoutSchema = z.looseObject({
  id: z.string(),
  d: z.string(),
  /** Epoch milliseconds. */
  start: z.number(),
  end: z.number(),
  routineId: z.string().nullable().optional(),
  name: z.string().default(""),
  entries: z.array(z.looseObject({ id: z.string(), sets: z.array(setSchema).default([]) })).default([]),
});

const routineSchema = z.looseObject({ id: z.string(), name: z.string().default(""), ex: z.array(z.looseObject({ id: z.string() })).catch([]).default([]) });
const weekSchema = z.record(z.string(), z.array(z.string()));
const customExSchema = z.record(z.string(), z.looseObject({ id: z.string(), n: z.string().optional() }));

export interface OpenGymState {
  unit: string;
  week: Record<string, string[]> | null;
  routines: Array<z.infer<typeof routineSchema>>;
  customEx: z.infer<typeof customExSchema> | null;
  /** Raw workouts by id; each is validated when read (openGymWorkouts). */
  workouts: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * GET /api/token/data, read field by field: a scoped token only returns the categories it can view, and a field
 * that is missing or shaped differently must not hide the rest. Throws only when there is no state at all.
 */
export function parseOpenGymState(body: unknown): OpenGymState {
  const state = isObject(body) && isObject(body.state) ? body.state : isObject(body) && isObject(body.data) ? body.data : null;
  if (!state) throw new Error("no openGym state");
  const routines = Array.isArray(state.routines) ? state.routines.flatMap((r) => (routineSchema.safeParse(r).success ? [routineSchema.parse(r)] : [])) : [];
  const rawWorkouts = state.workouts;
  const workouts = isObject(rawWorkouts)
    ? rawWorkouts
    : Array.isArray(rawWorkouts)
      ? Object.fromEntries(rawWorkouts.map((w, i) => [isObject(w) && typeof w.id === "string" ? w.id : String(i), w]))
      : {};
  const week = weekSchema.safeParse(state.week);
  // A view-only token returns customEx (and workouts) as lists instead of objects keyed by id
  const rawCustom = Array.isArray(state.customEx)
    ? Object.fromEntries(state.customEx.filter(isObject).map((e, i) => [typeof e.id === "string" ? e.id : String(i), e]))
    : state.customEx;
  const customEx = customExSchema.safeParse(rawCustom);
  return {
    unit: typeof state.unit === "string" ? state.unit : "kg",
    week: week.success ? week.data : null,
    routines,
    customEx: customEx.success ? customEx.data : null,
    workouts,
  };
}

export const weekPlanSchema = z.looseObject({
  today: z.string(),
  days: z.array(
    z.looseObject({
      date: z.string(),
      routine_ids: z.array(z.string()).default([]),
      routine_names: z.array(z.string()).default([]),
      planned_by: z.string().optional(),
    }),
  ),
});

const openingSetSchema = z.looseObject({
  phase: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  w: z.number().nullable().optional(),
  r: z.number().nullable().optional(),
});

export const previewSchema = z.looseObject({
  date: z.string(),
  routine_id: z.string(),
  routine_name: z.string(),
  unit: z.string().default("kg"),
  exercises: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      mode: z.string().optional(),
      planned: z
        .looseObject({ sets: z.number().nullable().optional(), reps: z.number().nullable().optional(), weight: z.number().nullable().optional(), summary: z.string().nullable().optional() })
        .nullable()
        .optional(),
      prescription: z
        .looseObject({ kind: z.string().nullable().optional(), weight: z.number().nullable().optional(), reps: z.number().nullable().optional(), why: z.string().nullable().optional() })
        .nullable()
        .optional(),
      opening_sets: z.array(openingSetSchema).default([]),
      differs_from_plan: z.boolean().optional(),
    }),
  ),
});

export const workoutDetailSchema = z.looseObject({
  id: z.string(),
  entries: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
});

export const routineDetailSchema = z.looseObject({
  id: z.string(),
  name: z.string().default(""),
  exercises: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
});

export const muscleBalanceSchema = z.looseObject({
  worked: z.array(z.looseObject({ slug: z.string(), name: z.string(), level: z.number() })).default([]),
  neglected: z.array(z.looseObject({ slug: z.string(), name: z.string() })).default([]),
});

export type OpenGymWorkout = z.infer<typeof openGymWorkoutSchema>;
export type OpenGymWeekPlan = z.infer<typeof weekPlanSchema>;
export type OpenGymPreview = z.infer<typeof previewSchema>;
export type OpenGymMuscleBalance = z.infer<typeof muscleBalanceSchema>;

/** Valid workouts of the state, newest first; malformed entries are skipped. */
export function openGymWorkouts(state: OpenGymState): OpenGymWorkout[] {
  return Object.values(state.workouts)
    .flatMap((raw) => {
      const parsed = openGymWorkoutSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.start - a.start);
}
