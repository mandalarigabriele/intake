import type { HealthWorkout, HeartRatePoint } from "../parsers/healthAutoExport.js";

/**
 * Labels and duplicate merging for workouts read from Apple Health (docs/apple-health.md).
 * The same session is often recorded by several apps; stored workouts stay raw and are merged on read,
 * so the rules can change without re-importing.
 */

/** Source app names as written by Health → labels shown in the app. Unknown sources keep their name. */
const SOURCE_LABELS: Record<string, string> = {
  "Google Health": "Fitbit",
  Fitbit: "Fitbit",
  MERACH: "MERACH",
  Hevy: "Hevy",
  Bevel: "Bevel",
};

/** Workout names as written by Health → label and family (sessions of the same family can be duplicates). */
const WORKOUT_TYPES: Record<string, { label: string; family: string }> = {
  "Allenamento di Forza Tradizionale": { label: "Forza", family: "Forza" },
  "Allenamento di Forza Funzionale": { label: "Forza", family: "Forza" },
  Ciclismo: { label: "Ciclismo", family: "Ciclismo" },
  "Interno Ciclismo": { label: "Cyclette", family: "Ciclismo" },
  Calcio: { label: "Calcio", family: "Calcio" },
  Camminata: { label: "Camminata", family: "Camminata" },
  Raquetball: { label: "Racchetta", family: "Racchetta" },
  Racquetball: { label: "Racchetta", family: "Racchetta" },
};

/** Which source gives the title / type and distance of a merged session (most specific first). */
const TYPE_PRIORITY = ["Hevy", "MERACH", "Fitbit", "Bevel"];
/** Which source gives heart rate and kcal of a merged session (the measuring device first). */
const METRICS_PRIORITY = ["Fitbit", "MERACH", "Bevel", "Hevy"];

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

export function workoutType(name: string): { label: string; family: string } {
  return WORKOUT_TYPES[name] ?? { label: name || "Allenamento", family: name || "Allenamento" };
}

export interface WorkoutSourceUse {
  label: string;
  /** False when the record was a duplicate whose data was not used. */
  used: boolean;
}

/** One session after duplicates are merged. Times are ISO strings with offset. */
export interface MergedWorkout {
  /** Id of the record that gave the title (stable across re-imports). */
  id: string;
  label: string;
  family: string;
  /** Source label of the record that gave the title. */
  source: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  kcal: number | null;
  distanceKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  heartRate: HeartRatePoint[];
  /** True when the group contains a workout written by Hevy: the Hevy API workout wins and takes only heart rate and kcal. */
  fromHevy: boolean;
  sources: WorkoutSourceUse[];
}

const startMs = (w: HealthWorkout) => Date.parse(w.start);
const endMs = (w: HealthWorkout) => Date.parse(w.end);

/** Same session: same family and an overlap of at least half of the shorter one. */
export function isSameSession(a: HealthWorkout, b: HealthWorkout): boolean {
  if (workoutType(a.name).family !== workoutType(b.name).family) return false;
  const overlap = Math.min(endMs(a), endMs(b)) - Math.max(startMs(a), startMs(b));
  if (overlap <= 0) return false;
  const shorter = Math.min(endMs(a) - startMs(a), endMs(b) - startMs(b));
  return overlap >= shorter / 2;
}

/** Records of one source within a group, combined (a session split in two pieces by the same app counts once). */
interface SourcePart {
  label: string;
  records: HealthWorkout[];
  kcal: number | null;
  distanceKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  heartRate: HeartRatePoint[];
}

function combineSource(label: string, records: HealthWorkout[]): SourcePart {
  const withKcal = records.filter((r) => r.kcal !== null);
  const withDistance = records.filter((r) => r.distanceKm !== null);
  const withHr = records.filter((r) => r.hrAvg !== null);
  const minutes = (r: HealthWorkout) => Math.max(1, (endMs(r) - startMs(r)) / 60_000);
  const hrWeight = withHr.reduce((sum, r) => sum + minutes(r), 0);
  const maxes = records.flatMap((r) => (r.hrMax === null ? [] : [r.hrMax]));
  return {
    label,
    records,
    kcal: withKcal.length ? Math.round(withKcal.reduce((sum, r) => sum + r.kcal!, 0)) : null,
    distanceKm: withDistance.length ? Math.round(withDistance.reduce((sum, r) => sum + r.distanceKm!, 0) * 100) / 100 : null,
    hrAvg: withHr.length ? Math.round(withHr.reduce((sum, r) => sum + r.hrAvg! * minutes(r), 0) / hrWeight) : null,
    hrMax: maxes.length ? Math.max(...maxes) : null,
    heartRate: records.flatMap((r) => r.heartRate),
  };
}

const rank = (priority: string[], label: string) => {
  const index = priority.indexOf(label);
  return index === -1 ? priority.length : index;
};

function mergeGroup(group: HealthWorkout[]): MergedWorkout {
  const bySource = new Map<string, HealthWorkout[]>();
  for (const record of group) {
    const label = sourceLabel(record.source);
    bySource.set(label, [...(bySource.get(label) ?? []), record]);
  }
  const parts = [...bySource.entries()].map(([label, records]) => combineSource(label, records));
  const byType = [...parts].sort((a, b) => rank(TYPE_PRIORITY, a.label) - rank(TYPE_PRIORITY, b.label));
  const byMetrics = [...parts].sort((a, b) => rank(METRICS_PRIORITY, a.label) - rank(METRICS_PRIORITY, b.label));

  const titlePart = byType[0]!;
  const titleRecord = titlePart.records[0]!;
  const type = workoutType(titleRecord.name);
  const pick = <K extends "kcal" | "distanceKm" | "hrAvg" | "hrMax">(order: SourcePart[], key: K) => order.find((p) => p[key] !== null);
  const kcalPart = pick(byMetrics, "kcal");
  const hrPart = pick(byMetrics, "hrAvg") ?? pick(byMetrics, "hrMax");
  const distancePart = pick(byType, "distanceKm");
  const curvePart = hrPart && hrPart.heartRate.length ? hrPart : byMetrics.find((p) => p.heartRate.length);
  const usedLabels = new Set([titlePart, kcalPart, hrPart, distancePart, curvePart].flatMap((p) => (p ? [p.label] : [])));

  const first = group.reduce((a, b) => (startMs(b) < startMs(a) ? b : a));
  const last = group.reduce((a, b) => (endMs(b) > endMs(a) ? b : a));
  return {
    id: titleRecord.id,
    label: type.label,
    family: type.family,
    source: titlePart.label,
    date: first.date,
    start: first.start,
    end: last.end,
    durationMinutes: Math.round((endMs(last) - startMs(first)) / 60_000),
    kcal: kcalPart?.kcal ?? null,
    distanceKm: distancePart?.distanceKm ?? null,
    hrAvg: hrPart?.hrAvg ?? null,
    hrMax: hrPart?.hrMax ?? null,
    heartRate: curvePart?.heartRate ?? [],
    fromHevy: bySource.has("Hevy"),
    sources: byType.map((p) => ({ label: p.label, used: usedLabels.has(p.label) })),
  };
}

/** Groups duplicate records (transitively: one session may overlap several) and merges each group. */
export function mergeWorkouts(workouts: HealthWorkout[]): MergedWorkout[] {
  const sorted = [...workouts].sort((a, b) => startMs(a) - startMs(b));
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && startMs(sorted[j]!) < endMs(sorted[i]!); j++) {
      if (isSameSession(sorted[i]!, sorted[j]!)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, HealthWorkout[]>();
  sorted.forEach((workout, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), workout]));
  return [...groups.values()].map(mergeGroup).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
