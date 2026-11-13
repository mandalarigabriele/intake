import type { TrainingLift, TrainingTargetExercise, TrainingView } from "@intake/shared";
import type { HevyRoutine, HevyWorkout } from "../parsers/hevy.js";
import { localDateTime } from "../parsers/hevy.js";
import { combineWorkouts } from "./dayWorkouts.js";
import type { MergedWorkout } from "./healthWorkouts.js";

/**
 * Andamento › Allenamenti (docs/design § Allenamenti). Routines and workouts come live from Hevy;
 * Apple Health only adds heart rate and the other activity of the week. Nothing is stored.
 */

const LIFTS = 6;
const MAIN_LIFTS_PER_ROUTINE = 2;
const RECENT = 4;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const minutesOf = (w: HevyWorkout) => Math.max(0, Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 60_000));
const working = <T extends { type: string }>(sets: T[]) => sets.filter((s) => s.type !== "warmup");

/** "Full Body A — Squat + Panca" → "A"; otherwise the position in the rotation. */
export function routineLetter(title: string, index: number): string {
  const match = /\b([A-Z])\s*[—–-]/.exec(title) ?? /\b([A-Z])$/.exec(title.trim());
  return match ? match[1]! : String.fromCharCode(65 + index);
}

/** Next weight to try: dumbbells go up 2 kg, everything else 2.5 kg. */
export function nextWeight(weightKg: number, title: string): number {
  return Math.round((weightKg + (/dumbbell|manubri/i.test(title) ? 2 : 2.5)) * 10) / 10;
}

/** The routines of one folder, in A → B → C order: the folder of the last routine done, else the largest. */
export function rotationOf(routines: HevyRoutine[], workouts: HevyWorkout[]): HevyRoutine[] {
  const lastRoutine = workouts.map((w) => routines.find((r) => r.id === w.routine_id)).find(Boolean);
  const folders = new Map<string, HevyRoutine[]>();
  for (const r of routines) {
    const key = String(r.folder_id ?? "none");
    folders.set(key, [...(folders.get(key) ?? []), r]);
  }
  const folder = lastRoutine ? folders.get(String(lastRoutine.folder_id ?? "none"))! : [...folders.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return [...folder].sort((a, b) => a.title.localeCompare(b.title, "it"));
}

/** Best working set of an exercise in a workout: heaviest, then most reps. */
function bestSet(workout: HevyWorkout, templateId: string) {
  const sets = workout.exercises.filter((e) => e.exercise_template_id === templateId).flatMap((e) => working(e.sets)).filter((s) => (s.weight_kg ?? 0) > 0);
  return sets.reduce<(typeof sets)[number] | null>((top, s) => (!top || s.weight_kg! > top.weight_kg! || (s.weight_kg === top.weight_kg && (s.reps ?? 0) > (top.reps ?? 0)) ? s : top), null);
}

/** Every working set at the top weight reached the top of the rep range in the last session with the exercise. */
function readyToProgress(workouts: HevyWorkout[], templateId: string, repEnd: number | null, title: string): number | null {
  if (repEnd === null) return null;
  const last = workouts.find((w) => w.exercises.some((e) => e.exercise_template_id === templateId));
  if (!last) return null;
  const sets = last.exercises.filter((e) => e.exercise_template_id === templateId).flatMap((e) => working(e.sets)).filter((s) => (s.weight_kg ?? 0) > 0);
  if (sets.length === 0) return null;
  const top = Math.max(...sets.map((s) => s.weight_kg!));
  const atTop = sets.filter((s) => s.weight_kg === top);
  return atTop.every((s) => (s.reps ?? 0) >= repEnd) ? nextWeight(top, title) : null;
}

export function buildTraining(input: {
  routines: HevyRoutine[];
  /** Hevy workouts, newest first. */
  workouts: HevyWorkout[];
  health: MergedWorkout[];
  timeZone: string;
  today: string;
}): TrainingView {
  const { routines, workouts, health, timeZone, today } = input;
  const rotation = rotationOf(routines, workouts);
  const letterOf = (routineId: string | null | undefined) => {
    const i = rotation.findIndex((r) => r.id === routineId);
    return i === -1 ? null : routineLetter(rotation[i]!.title, i);
  };
  // Exercise titles as logged (the app's language), newest first
  const loggedTitle = new Map<string, string>();
  for (const w of workouts) for (const e of w.exercises) if (e.exercise_template_id && !loggedTitle.has(e.exercise_template_id)) loggedTitle.set(e.exercise_template_id, e.title);

  // Next routine: the one after the last routine done, wrapping around
  const last = workouts.find((w) => rotation.some((r) => r.id === w.routine_id));
  const nextIndex = last ? (rotation.findIndex((r) => r.id === last.routine_id) + 1) % rotation.length : 0;
  const nextRoutine = rotation[nextIndex];
  const next: TrainingView["next"] = nextRoutine
    ? (() => {
        const durations = workouts.filter((w) => w.routine_id === nextRoutine.id).slice(0, 3).map(minutesOf);
        const exercises: TrainingTargetExercise[] = nextRoutine.exercises.map((e) => {
          const sets = working(e.sets);
          const range = sets.find((s) => s.rep_range?.start != null && s.rep_range?.end != null)?.rep_range;
          const repRange = range ? { start: range.start!, end: range.end! } : null;
          const title = (e.exercise_template_id && loggedTitle.get(e.exercise_template_id)) || e.title;
          return {
            templateId: e.exercise_template_id ?? null,
            title,
            templateTitle: e.title,
            sets: sets.length,
            weights: sets.map((s) => s.weight_kg ?? 0).filter((w) => w > 0),
            repRange,
            superset: e.superset_id != null,
            suggestKg: e.exercise_template_id ? readyToProgress(workouts, e.exercise_template_id, repRange?.end ?? null, title) : null,
          };
        });
        return {
          routineId: nextRoutine.id,
          title: nextRoutine.title.trim(),
          letter: routineLetter(nextRoutine.title, nextIndex),
          after: last ? { title: last.title.trim(), date: localDateTime(last.start_time, timeZone).date } : null,
          exerciseCount: nextRoutine.exercises.length,
          typicalMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 5) * 5 : null,
          exercises,
        };
      })()
    : null;

  // This week (Monday to Sunday), with heart rate and other activity from Apple Health
  const start = mondayOf(today);
  const end = addDays(start, 6);
  const sessions = combineWorkouts(workouts, health, timeZone);
  const hevyWeek = workouts.filter((w) => {
    const d = localDateTime(w.start_time, timeZone).date;
    return d >= start && d <= end;
  });
  // Other activity: Health sessions that are not strength (strength is Hevy's; an unmatched copy is not extra work)
  const otherWeek = sessions.filter((s) => s.origin === "health" && s.family !== "Forza" && s.date >= start && s.date <= end);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const hevy = hevyWeek.find((w) => localDateTime(w.start_time, timeZone).date === date);
    const other = otherWeek.find((s) => s.date === date);
    return {
      date,
      letter: hevy ? letterOf(hevy.routine_id) ?? "•" : null,
      title: hevy ? hevy.title.trim() : null,
      minutes: hevy ? minutesOf(hevy) : null,
      other: other ? `${other.type} ${other.durationMinutes} min` : null,
    };
  });
  const week: TrainingView["week"] = {
    start,
    days,
    done: new Set(hevyWeek.map((w) => w.routine_id).filter((id) => rotation.some((r) => r.id === id))).size,
    total: rotation.length,
    minutes: hevyWeek.reduce((sum, w) => sum + minutesOf(w), 0),
    exercises: hevyWeek.reduce((sum, w) => sum + w.exercises.length, 0),
    other: otherWeek.map((s) => ({ type: s.type, date: s.date, source: s.source })),
  };

  // Load progress: the main lifts, i.e. the first weighted exercises of each routine (where the plan puts them)
  const candidates = new Map<string, { title: string; routines: string[]; order: number }>();
  rotation.forEach((r, ri) =>
    r.exercises.filter((e) => working(e.sets).some((s) => (s.weight_kg ?? 0) > 0)).slice(0, MAIN_LIFTS_PER_ROUTINE).forEach((e, ei) => {
      if (!e.exercise_template_id) return;
      const entry = candidates.get(e.exercise_template_id) ?? { title: loggedTitle.get(e.exercise_template_id) ?? e.title, routines: [], order: ri * 100 + ei };
      entry.routines.push(routineLetter(r.title, ri));
      candidates.set(e.exercise_template_id, entry);
    }),
  );
  const lifts: TrainingLift[] = [...candidates.entries()]
    .map(([templateId, c]) => {
      const points = [...workouts]
        .reverse()
        .flatMap((w) => {
          const best = bestSet(w, templateId);
          return best ? [{ date: localDateTime(w.start_time, timeZone).date, weightKg: best.weight_kg!, reps: best.reps ?? null }] : [];
        });
      const routineSet = rotation.flatMap((r) => r.exercises).find((e) => e.exercise_template_id === templateId);
      const repEnd = routineSet ? working(routineSet.sets).find((s) => s.rep_range?.end != null)?.rep_range?.end ?? null : null;
      const suggest = readyToProgress(workouts, templateId, repEnd, c.title);
      const lastPoint = points.at(-1);
      const previous = points.at(-2);
      const first = points[0];
      const change: TrainingLift["change"] =
        suggest !== null
          ? { kind: "ready", suggestKg: suggest }
          : lastPoint && previous && lastPoint.weightKg > previous.weightKg
            ? { kind: "last", kg: Math.round((lastPoint.weightKg - previous.weightKg) * 10) / 10 }
            : lastPoint && first && lastPoint.weightKg > first.weightKg
              ? { kind: "since", kg: Math.round((lastPoint.weightKg - first.weightKg) * 10) / 10, since: first.date }
              : { kind: "flat" };
      return { templateId, title: c.title, routines: c.routines, points, change, order: c.order };
    })
    .filter((l) => l.points.length >= 2)
    .sort((a, b) => a.order - b.order)
    .slice(0, LIFTS)
    .map(({ order: _order, ...lift }) => lift);

  const recent = sessions
    .filter((s) => s.origin === "hevy")
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))
    .slice(0, RECENT)
    .map((s) => {
      const raw = workouts.find((w) => w.id === s.id);
      return {
        id: s.id,
        letter: raw ? letterOf(raw.routine_id) : null,
        title: s.title,
        date: s.date,
        start: s.start,
        minutes: s.durationMinutes,
        exercises: raw?.exercises.length ?? s.exercises.length,
        hrAvg: s.hrAvg,
      };
    });

  return { configured: true, today, next, week, lifts, recent };
}
