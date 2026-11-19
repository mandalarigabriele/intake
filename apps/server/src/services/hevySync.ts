import type { HevySyncExercise, HevySyncItem } from "@intake/shared";
import { createHash } from "node:crypto";
import type { ExerciseLink, HevySyncStore } from "../db/hevySyncStore.js";
import type { HevyApi, HevyNewTemplate, HevyTemplate, HevyWriteSet, HevyWriteWorkout } from "../hevy/hevyApi.js";
import type { OpenGymApi } from "../opengym/openGymApi.js";
import type { HevyWorkout } from "../parsers/hevy.js";
import { openGymWorkouts, type OpenGymState, type OpenGymWorkout } from "../parsers/openGym.js";

/**
 * Optional copy of openGym workouts into Hevy (docs/hevy-sync.md). openGym stays the place where sessions are
 * logged; Hevy gets a copy so its history stays complete. Read-only on the openGym side.
 *
 * - Only workouts of the last WINDOW_DAYS with at least one done set are considered.
 * - A workout already in Hevy (overlapping in time, e.g. one imported into openGym from Hevy) is never copied.
 * - Each openGym exercise is sent as the Hevy exercise learned from workouts present in both apps; an exercise never
 *   done in Hevy becomes a custom Hevy exercise, created once.
 * - A copied workout changed later in openGym is updated in Hevy; nothing is ever deleted.
 */

const DAY_MS = 86_400_000;
/** How far back the copy looks. */
export const WINDOW_DAYS = 30;
/** RPE values the Hevy API accepts. */
const HEVY_RPE = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const LB_TO_KG = 0.45359237;

type OpenGymSet = OpenGymWorkout["entries"][number]["sets"][number];

const isDone = (s: OpenGymSet) => s.done !== false;
const doneSets = (e: OpenGymWorkout["entries"][number]) => e.sets.filter(isDone);
const hasWork = (w: OpenGymWorkout) => w.entries.some((e) => doneSets(e).length > 0);
const isCardioSet = (s: OpenGymSet) => s.min != null && s.w == null && s.r == null;

/** Same session: they overlap for at least half of the shorter one. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const shorter = Math.max(Math.min(a.end - a.start, b.end - b.start), 60_000);
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) >= shorter / 2;
}

const hevySpan = (w: HevyWorkout) => ({ start: Date.parse(w.start_time), end: Date.parse(w.end_time) });

function toKg(weight: number | null | undefined, unit: string): number | null {
  if (weight == null) return null;
  return Math.round((unit === "lb" ? weight * LB_TO_KG : weight) * 100) / 100;
}

/** The closest RPE Hevy accepts; below 6 (or none) is left out. */
export function hevyRpe(rpe: number | null | undefined): number | null {
  if (rpe == null || rpe < 5.75) return null;
  return HEVY_RPE.reduce((best, value) => (Math.abs(value - rpe) < Math.abs(best - rpe) ? value : best));
}

export function hevySet(set: OpenGymSet, unit: string): HevyWriteSet {
  if (isCardioSet(set)) {
    const minutes = set.min ?? 0;
    return {
      type: "normal",
      weight_kg: null,
      reps: null,
      duration_seconds: Math.round(minutes * 60),
      distance_meters: set.speed ? Math.round((set.speed * minutes * 1000) / 60) : null,
      rpe: null,
    };
  }
  return { type: set.phase === "warmup" ? "warmup" : "normal", weight_kg: toKg(set.w, unit), reps: set.r ?? null, duration_seconds: null, distance_meters: null, rpe: hevyRpe(set.rpe) };
}

/** What was done in openGym, for change detection (title, times and done sets). */
export function contentHash(workout: OpenGymWorkout): string {
  const content = {
    name: workout.name,
    start: workout.start,
    end: workout.end,
    entries: workout.entries.map((e) => ({ id: e.id, sets: doneSets(e).map((s) => [s.w ?? null, s.r ?? null, s.phase ?? null, s.rpe ?? null, s.min ?? null, s.speed ?? null]) })),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32);
}

const signature = (sets: Array<{ w: number | null; r: number | null }>) => sets.map((s) => `${s.w ?? "-"}x${s.r ?? "-"}`).join("|");

/**
 * Hevy exercise for each openGym exercise, learned from workouts present in both apps (openGym's import from Hevy
 * keeps times and sets): an openGym entry whose done sets are exactly those of one Hevy exercise is that exercise.
 * The template most often matched wins.
 */
export function learnExercises(openGym: OpenGymWorkout[], hevy: HevyWorkout[], unit: string): Map<string, { templateId: string; title: string }> {
  const votes = new Map<string, Map<string, { title: string; count: number }>>();
  for (const workout of openGym) {
    const twin = hevy.find((h) => overlaps(workout, hevySpan(h)));
    if (!twin) continue;
    const hevySignatures = twin.exercises
      .filter((e) => e.exercise_template_id)
      .map((e) => ({ id: e.exercise_template_id!, title: e.title, sig: signature(e.sets.map((s) => ({ w: s.weight_kg ?? null, r: s.reps ?? null }))) }));
    for (const entry of workout.entries) {
      const sets = doneSets(entry);
      if (sets.length === 0 || sets.some(isCardioSet)) continue;
      const sig = signature(sets.map((s) => ({ w: toKg(s.w, unit), r: s.r ?? null })));
      const matches = hevySignatures.filter((h) => h.sig === sig);
      // Two Hevy exercises with the same sets: ambiguous, no vote
      if (matches.length !== 1) continue;
      const forEntry = votes.get(entry.id) ?? new Map<string, { title: string; count: number }>();
      const vote = forEntry.get(matches[0]!.id) ?? { title: matches[0]!.title, count: 0 };
      vote.count++;
      forEntry.set(matches[0]!.id, vote);
      votes.set(entry.id, forEntry);
    }
  }
  const learned = new Map<string, { templateId: string; title: string }>();
  for (const [openGymId, candidates] of votes) {
    const [templateId, best] = [...candidates.entries()].sort((a, b) => b[1].count - a[1].count)[0]!;
    learned.set(openGymId, { templateId, title: best.title });
  }
  return learned;
}

/** Words of an exercise name, order and punctuation aside: "cable single arm lateral raise v. 2" = "Single Arm Lateral Raise (Cable)". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bv\.?\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["with", "the", "a", "on", "attachment"].includes(w))
    .map((w) => (w.endsWith("s") && w.length > 3 && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .sort()
    .join(" ");
}

/** The Hevy exercise with the same name: a library one first, else a custom one (never create a second copy). */
export function templateByName(name: string, templates: HevyTemplate[]): HevyTemplate | null {
  const key = nameKey(name);
  const same = templates.filter((t) => nameKey(t.title) === key);
  return same.find((t) => !t.custom) ?? same[0] ?? null;
}

const capitalize = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** A custom Hevy exercise for an openGym exercise never done in Hevy. */
export function newTemplate(name: string, sets: OpenGymSet[]): HevyNewTemplate {
  const lower = name.toLowerCase();
  const cardio = sets.some(isCardioSet);
  const equipment: HevyNewTemplate["equipment_category"] = /barbell|landmine/.test(lower)
    ? "barbell"
    : /dumbbell/.test(lower)
      ? "dumbbell"
      : /kettlebell/.test(lower)
        ? "kettlebell"
        : /band/.test(lower)
          ? "resistance_band"
          : /cable|machine|lever|smith|bike|treadmill|rower|elliptical/.test(lower)
            ? "machine"
            : /body ?weight/.test(lower)
              ? "none"
              : "other";
  return {
    title: capitalize(name),
    exercise_type: cardio ? (sets.some((s) => s.speed) ? "distance_duration" : "duration") : sets.every((s) => s.w == null) ? "reps_only" : "weight_reps",
    equipment_category: equipment,
    muscle_group: cardio ? "cardio" : "other",
  };
}

export interface HevySyncPlan {
  items: HevySyncItem[];
  /** For each item to send: the openGym workout and the exercise names. */
  work: Array<{ item: HevySyncItem; workout: OpenGymWorkout; names: Map<string, string>; existing: string | null }>;
  exercises: Map<string, ExerciseLink | { templateId: string; title: string; origin: "learned" | "name" }>;
  templates: HevyTemplate[];
  unit: string;
}

export interface HevySyncDeps {
  store: HevySyncStore;
  hevy: Pick<HevyApi, "workoutsSince" | "createWorkout" | "updateWorkout" | "createExerciseTemplate" | "exerciseTemplates">;
  openGym: Pick<OpenGymApi, "state" | "exerciseNames">;
  now?: () => number;
  log: { warn(details: object, message: string): void; info(details: object, message: string): void };
  /** False while the Allenamenti part is off: the periodic copy is skipped. */
  enabled?: () => boolean;
}

export class HevySync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: HevySyncDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** What the next run would send (also the preview shown in Profile before turning the copy on). */
  async plan(): Promise<HevySyncPlan> {
    const { store, hevy, openGym } = this.deps;
    const state: OpenGymState = await openGym.state();
    const since = this.now() - WINDOW_DAYS * DAY_MS;
    const recent = openGymWorkouts(state).filter((w) => w.start >= since && hasWork(w));
    // A little more of Hevy than of openGym, so a twin that started just before the window is still seen
    const hevyWorkouts = await hevy.workoutsSince(new Date(since - DAY_MS).toISOString());
    const links = store.links();
    const linkedHevyIds = new Set([...links.values()].map((l) => l.hevyId));

    const saved = store.exerciseLinks();
    const exercises = new Map<string, ExerciseLink | { templateId: string; title: string; origin: "learned" | "name" }>(saved);
    for (const [id, learned] of learnExercises(recent, hevyWorkouts, state.unit)) if (!saved.has(id)) exercises.set(id, { ...learned, origin: "learned" });
    const templates = await hevy.exerciseTemplates();

    const work: HevySyncPlan["work"] = [];
    for (const workout of [...recent].reverse()) {
      const link = links.get(workout.id);
      const hash = contentHash(workout);
      if (link && link.hash === hash) continue;
      // Already in Hevy (logged there, or imported into openGym from there): never copied
      if (!link && hevyWorkouts.some((h) => !linkedHevyIds.has(h.id) && overlaps(workout, hevySpan(h)))) continue;
      const names = await openGym.exerciseNames(workout.id).catch(() => new Map<string, string>());
      const custom = state.customEx ?? {};
      // Not learned: a Hevy exercise with the same name (library first, then an existing custom one)
      for (const e of workout.entries) {
        const name = names.get(e.id) ?? custom[e.id]?.n;
        const byName = !exercises.has(e.id) && name ? templateByName(name, templates) : null;
        if (byName) exercises.set(e.id, { templateId: byName.id, title: byName.title, origin: "name" });
      }
      const items: HevySyncExercise[] = workout.entries
        .filter((e) => doneSets(e).length > 0)
        .map((e) => {
          const match = exercises.get(e.id);
          return { name: names.get(e.id) ?? custom[e.id]?.n ?? e.id, hevyTitle: match?.title ?? null, origin: match?.origin ?? "new" };
        });
      const item: HevySyncItem = {
        id: workout.id,
        title: workout.name.trim() || "Workout",
        start: new Date(workout.start).toISOString(),
        minutes: Math.round((workout.end - workout.start) / 60_000),
        action: link ? "update" : "create",
        exercises: items,
      };
      work.push({ item, workout, names, existing: link?.hevyId ?? null });
    }
    return { items: work.map((w) => w.item), work, exercises, templates, unit: state.unit };
  }

  /** Sends what the plan holds. Runs one at a time; does nothing while the copy is off. */
  run(): Promise<void> {
    if (!this.deps.store.enabled()) return Promise.resolve();
    this.running ??= this.send().finally(() => (this.running = null));
    return this.running;
  }

  private async send(): Promise<void> {
    const { store, hevy, log } = this.deps;
    let created = 0;
    let updated = 0;
    try {
      const plan = await this.plan();
      for (const { workout, names, existing } of plan.work) {
        const exercises: HevyWriteWorkout["exercises"] = [];
        for (const entry of workout.entries) {
          const sets = doneSets(entry);
          if (sets.length === 0) continue;
          let link = plan.exercises.get(entry.id);
          if (!link) {
            // Not in Hevy under any name: a custom exercise, created once and remembered
            const name = names.get(entry.id) ?? entry.id;
            const template = newTemplate(name, sets);
            const templateId = (await hevy.createExerciseTemplate(template)) ?? templateByName(template.title, await hevy.exerciseTemplates())?.id;
            if (!templateId) throw new Error(`Hevy created the exercise "${template.title}" but it could not be found`);
            link = { openGymId: entry.id, templateId, title: template.title, origin: "custom" };
            store.saveExerciseLink(link);
            plan.exercises.set(entry.id, link);
          } else if (link.origin === "learned" || link.origin === "name") {
            store.saveExerciseLink({ openGymId: entry.id, templateId: link.templateId, title: link.title, origin: link.origin });
          }
          exercises.push({ exercise_template_id: link.templateId, superset_id: null, notes: null, sets: sets.map((s) => hevySet(s, plan.unit)) });
        }
        if (exercises.length === 0) continue;
        const payload: HevyWriteWorkout = {
          title: workout.name.trim() || "Workout",
          start_time: new Date(workout.start).toISOString(),
          end_time: new Date(workout.end).toISOString(),
          is_private: true,
          exercises,
        };
        if (existing) {
          await hevy.updateWorkout(existing, payload);
          store.saveLink({ openGymId: workout.id, hevyId: existing, hash: contentHash(workout) });
          updated++;
        } else {
          // When Hevy does not return the id, the new workout is found by its start time
          const hevyId =
            (await hevy.createWorkout(payload)) ??
            (await hevy.workoutsSince(new Date(workout.start - 60_000).toISOString())).find((h) => Math.abs(Date.parse(h.start_time) - workout.start) < 60_000)?.id;
          if (!hevyId) throw new Error(`Hevy created "${payload.title}" but it could not be found`);
          store.saveLink({ openGymId: workout.id, hevyId, hash: contentHash(workout) });
          created++;
        }
      }
      store.setLastRun({ at: new Date(this.now()).toISOString(), created, updated, error: null });
      if (created || updated) log.info({ created, updated }, "Copied openGym workouts to Hevy");
    } catch (error) {
      // Whatever was sent before the error is linked already; the rest is retried next time
      const message = (error as Error).message;
      store.setLastRun({ at: new Date(this.now()).toISOString(), created, updated, error: message });
      log.warn({ err: message }, "openGym → Hevy copy failed");
    }
  }

  /** Checks every `intervalMs` (default 15 minutes) while the copy is on. */
  start(intervalMs = 15 * 60_000): void {
    this.timer = setInterval(() => {
      if (this.deps.enabled?.() ?? true) void this.run();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
