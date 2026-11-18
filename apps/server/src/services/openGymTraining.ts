import type { TrainingTargetExercise, TrainingView } from "@intake/shared";
import type { HevyRoutine, HevyWorkout } from "../parsers/hevy.js";
import { localDateTime } from "../parsers/hevy.js";
import type { OpenGymMuscleBalance, OpenGymPreview, OpenGymState, OpenGymWeekPlan } from "../parsers/openGym.js";
import type { MergedWorkout } from "./healthWorkouts.js";
import { buildTraining, routineLetter } from "./training.js";

/**
 * Andamento › Allenamenti from openGym (docs/opengym.md). openGym plans by weekday and computes the session a
 * routine opens with, so Intake shows that instead of guessing: the next planned session with its opening sets and
 * the reason when it differs from the routine. Week, load progress and recent workouts reuse the Hevy view on the
 * workouts mapped to the same shape.
 */

/** "1 · Forza — Squat & Panca" → "1"; a routine without a number keeps its initial ("Cyclette" → "C"). */
export function openGymLetter(name: string): string {
  return /^\s*\d+\s*[·.)\-–—]/.test(name) ? routineLetter(name, 0) : (name.trim().charAt(0).toUpperCase() || "•");
}

/** Routines in the Hevy routine shape, for the shared load-progress and week logic. */
export function routinesAsHevy(state: Pick<OpenGymState, "routines">): HevyRoutine[] {
  return state.routines.map((r) => ({
    id: r.id,
    title: r.name,
    folder_id: 1,
    exercises: r.ex.map((e) => {
      const ex = e as { id: string; sets?: number; reps?: number; repsMin?: number; weight?: number };
      return {
        title: ex.id,
        exercise_template_id: ex.id,
        superset_id: null,
        sets: Array.from({ length: ex.sets ?? 1 }, () => ({
          type: "normal",
          weight_kg: ex.weight ?? null,
          rep_range: ex.reps ? { start: ex.repsMin ?? ex.reps, end: ex.reps } : null,
        })),
      };
    }),
  }));
}

/** Keywords in a cardio routine or exercise name → the Apple Health workout family it stands for (healthWorkouts.ts). */
const CARDIO_FAMILIES: Array<[RegExp, string]> = [
  [/cyclette|bike|cycl|bici|spinning/i, "Ciclismo"],
  [/walk|cammin/i, "Camminata"],
];

/**
 * The Health family a cardio routine stands for ("Cyclette — Zona 2" → Ciclismo), or null for a strength routine.
 * A routine is cardio when none of its exercises counts reps.
 */
export function cardioFamily(routine: OpenGymState["routines"][number], names?: Map<string, string>): string | null {
  const exercises = routine.ex as Array<{ id: string; mode?: string | null }>;
  if (exercises.length === 0 || exercises.some((e) => (e.mode ?? null) === "reps")) return null;
  const text = [routine.name, ...exercises.map((e) => names?.get(e.id) ?? "")].join(" ");
  return CARDIO_FAMILIES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/**
 * Cardio routines covered on a date by an Apple Health workout of the same family (a ride recorded by the watch
 * stands for "Cyclette — Zona 2" when the session was not logged in openGym). Nothing is written to openGym.
 */
export function healthCoveredRoutines(state: Pick<OpenGymState, "routines">, health: MergedWorkout[], date: string, names?: Map<string, string>): Set<string> {
  const families = new Set(health.filter((h) => h.date === date).map((h) => h.family));
  return new Set(
    state.routines.flatMap((r) => {
      const family = cardioFamily(r, names);
      return family && families.has(family) ? [r.id] : [];
    }),
  );
}

/** The first planned day after `date`. */
export function plannedAfter(plan: OpenGymWeekPlan, date: string): string | null {
  return plan.days.find((d) => d.routine_ids.length > 0 && d.date > date)?.date ?? null;
}

/** The first planned day from today whose session is not done yet (in openGym, or a cardio routine covered by Health). */
export function nextPlannedDate(plan: OpenGymWeekPlan, workouts: HevyWorkout[], timeZone: string, coveredToday: Set<string> = new Set()): string | null {
  const doneToday = new Set<string | null | undefined>([...coveredToday, ...workouts.filter((w) => localDateTime(w.start_time, timeZone).date === plan.today).map((w) => w.routine_id)]);
  const day = plan.days.find((d) => d.routine_ids.length > 0 && !(d.date === plan.today && d.routine_ids.every((id) => doneToday.has(id))));
  return day?.date ?? null;
}

function targetExercise(e: OpenGymPreview["exercises"][number]): TrainingTargetExercise {
  const work = e.opening_sets.filter((s) => s.phase !== "warmup");
  // Cardio and timed exercises: openGym's own target ("1 × 20 min @ 20 km/h") instead of sets × reps
  if (e.mode && e.mode !== "reps") {
    return {
      templateId: e.id,
      title: e.name,
      templateTitle: e.name,
      sets: work.length,
      weights: [],
      repRange: null,
      superset: false,
      suggestKg: null,
      openingReps: null,
      note: e.differs_from_plan && e.prescription?.why ? e.prescription.why : null,
      label: e.planned?.summary ?? work[0]?.label ?? null,
    };
  }
  const range = /(\d+)\s*[–-]\s*(\d+)/.exec(e.planned?.summary ?? "");
  const repRange = range ? { start: Number(range[1]), end: Number(range[2]) } : e.planned?.reps ? { start: e.planned.reps, end: e.planned.reps } : null;
  return {
    templateId: e.id,
    title: e.name,
    templateTitle: e.name,
    sets: work.length,
    weights: work.map((s) => s.w ?? 0).filter((w) => w > 0),
    repRange,
    superset: false,
    suggestKg: null,
    openingReps: work[0]?.r ?? null,
    note: e.differs_from_plan && e.prescription?.why ? e.prescription.why : null,
  };
}

/** Change of the best set: in the last session, else since the first session of the window, else flat. */
export function trendOnly(points: Array<{ date: string; weightKg: number }>): TrainingView["lifts"][number]["change"] {
  const last = points.at(-1);
  const previous = points.at(-2);
  const first = points[0];
  if (last && previous && last.weightKg > previous.weightKg) return { kind: "last", kg: Math.round((last.weightKg - previous.weightKg) * 10) / 10 };
  if (last && first && last.weightKg > first.weightKg) return { kind: "since", kg: Math.round((last.weightKg - first.weightKg) * 10) / 10, since: first.date };
  return { kind: "flat" };
}

export function buildOpenGymTraining(input: {
  state: OpenGymState;
  plan: OpenGymWeekPlan;
  preview: OpenGymPreview | null;
  /** The session after `preview` when that one is planned today. */
  following?: OpenGymPreview | null;
  muscles: OpenGymMuscleBalance | null;
  /** Exercise names of the routines (get_routine), used when a workout read in detail does not name one. */
  routineNames?: Map<string, string>;
  /** openGym workouts in the Hevy shape, newest first. */
  workouts: HevyWorkout[];
  health: MergedWorkout[];
  timeZone: string;
  today: string;
  openUrl: string;
}): TrainingView {
  const { state, plan, preview, following, muscles, routineNames, workouts, health, timeZone, today, openUrl } = input;
  const base = buildTraining({ routines: routinesAsHevy(state), workouts, health, timeZone, today });
  const coveredToday = healthCoveredRoutines(state, health, today, routineNames);
  const letterOf = (routineId: string | null | undefined, title = "") => {
    const routine = state.routines.find((r) => r.id === routineId);
    if (routine) return openGymLetter(routine.name);
    // Workouts imported from Hevy have no openGym routine: "Full Body C — …" still reads as "C"
    return /\b([A-Z])\s*[—–-]/.exec(title)?.[1] ?? null;
  };

  const last = workouts[0];
  /** A session preview in the view shape (next, and the one after it when next is today). */
  const sessionFrom = (preview: OpenGymPreview | null | undefined): TrainingView["next"] =>
    preview
      ? {
          routineId: preview.routine_id,
          title: preview.routine_name,
          letter: openGymLetter(preview.routine_name),
          after: last ? { title: last.title, date: localDateTime(last.start_time, timeZone).date } : null,
          exerciseCount: preview.exercises.length,
          typicalMinutes: (() => {
            const durations = workouts
              .filter((w) => w.routine_id === preview.routine_id)
              .slice(0, 3)
              .map((w) => Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 60_000));
            return durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 5) * 5 : null;
          })(),
          date: preview.date,
          exercises: preview.exercises.map(targetExercise),
        }
      : null;
  const next = sessionFrom(preview);

  // Week: what was done (routine numbers) and, for the days still to come, what the plan holds
  const plannedOn = new Map(plan.days.map((d) => [d.date, d.routine_ids]));
  const weekdays = state.week ?? {};
  const days = base.week.days.map((d) => {
    const raw = workouts.find((w) => localDateTime(w.start_time, timeZone).date === d.date);
    const plannedIds = d.date >= today ? plannedOn.get(d.date) ?? [] : [];
    // A cardio session of today recorded only in Apple Health counts as done
    const covered = !raw && d.date === today && plannedIds.length > 0 && plannedIds.every((id) => coveredToday.has(id));
    return {
      ...d,
      letter: raw ? letterOf(raw.routine_id, raw.title) ?? "•" : covered ? plannedIds.map((id) => letterOf(id) ?? "•").join("+") : null,
      planned: !raw && !covered && plannedIds.length ? plannedIds.map((id) => letterOf(id) ?? "•").join("+") : null,
    };
  });
  const week: TrainingView["week"] = {
    ...base.week,
    days,
    done: days.filter((d) => d.letter).length,
    total: Object.values(weekdays).filter((ids) => ids.length > 0).length,
  };

  // Exercise names: from the workouts read in detail, else from the session preview; routines by their short name
  const names = new Map<string, string>();
  for (const w of workouts) for (const e of w.exercises) if (e.exercise_template_id && e.title !== e.exercise_template_id) names.set(e.exercise_template_id, e.title);
  for (const e of preview?.exercises ?? []) if (!names.has(e.id)) names.set(e.id, e.name);
  for (const [id, name] of routineNames ?? []) if (!names.has(id)) names.set(id, name);
  const shortName = (name: string) => name.split(/\s+[—–-]\s+/)[0]!.trim();
  const routineByLetter = new Map(state.routines.map((r) => [openGymLetter(r.name), shortName(r.name)]));
  // openGym decides the next load (the session preview): the lifts only show the trend, never Intake's own hint
  const lifts = base.lifts.map((l) => ({
    ...l,
    title: names.get(l.templateId) ?? l.title,
    routines: l.routines.map((letter) => routineByLetter.get(letter) ?? letter),
    change: trendOnly(l.points),
  }));

  const recent = base.recent.map((r) => {
    const raw = workouts.find((w) => w.id === r.id);
    return { ...r, letter: raw ? letterOf(raw.routine_id, raw.title) : r.letter };
  });

  return {
    ...base,
    source: { id: "opengym", label: "openGym", openUrl },
    next,
    following: next?.date === today ? sessionFrom(following) : null,
    week,
    lifts,
    recent,
    muscles: muscles
      ? { top: muscles.worked.filter((m) => m.level >= 4).map((m) => m.slug), neglected: muscles.neglected.map((m) => m.slug) }
      : null,
  };
}
