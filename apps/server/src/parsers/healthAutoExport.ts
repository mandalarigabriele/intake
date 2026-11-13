import { z } from "zod";
import { ParseError, type Parsed } from "./common.js";

/**
 * Health Auto Export (iOS) JSON export, as sent by a manual export or the REST API automation:
 * `{ data: { metrics: [...], workouts: [...], ... } }` with metrics aggregated per day.
 * Timestamps look like "2026-10-26 00:00:00 +0100" and carry the phone's local offset.
 * See docs/apple-health.md for what is imported and why.
 */

const quantitySchema = z.looseObject({ qty: z.number(), units: z.string().default("") });

const pointSchema = z.looseObject({ date: z.string(), qty: z.number().optional(), source: z.string().optional() });

const sleepPointSchema = z.looseObject({
  date: z.string(),
  sleepStart: z.string(),
  sleepEnd: z.string(),
  totalSleep: z.number().default(0),
  deep: z.number().default(0),
  rem: z.number().default(0),
  core: z.number().default(0),
  awake: z.number().default(0),
  inBed: z.number().default(0),
  source: z.string().optional(),
});

const metricSchema = z.looseObject({
  name: z.string(),
  units: z.string().default(""),
  data: z.array(z.unknown()).default([]),
});

const heartRatePointSchema = z.looseObject({ date: z.string(), Avg: z.number() });

const workoutSchema = z.looseObject({
  id: z.string(),
  name: z.string().default(""),
  start: z.string(),
  end: z.string(),
  duration: z.number().optional(),
  source: z.looseObject({ name: z.string().default("") }).optional(),
  activeEnergyBurned: quantitySchema.optional(),
  distance: quantitySchema.optional(),
  avgHeartRate: quantitySchema.optional(),
  maxHeartRate: quantitySchema.optional(),
  heartRate: z.looseObject({ avg: quantitySchema.optional(), max: quantitySchema.optional() }).optional(),
  heartRateData: z.array(z.unknown()).default([]),
  route: z.array(z.unknown()).optional(),
});

const exportSchema = z.looseObject({
  data: z.looseObject({
    metrics: z.array(metricSchema).default([]),
    workouts: z.array(z.unknown()).default([]),
  }),
});

/** Daily values stored in Intake. Energy is always kcal, distance km. */
export type HealthMetric = "steps" | "distanceKm" | "activeKcal" | "restingKcal" | "restingHr";

export interface HealthDailyValue {
  date: string;
  metric: HealthMetric;
  value: number;
}

/** One night, assigned to the wake-up day. Times are ISO strings with offset. */
export interface HealthSleep {
  date: string;
  start: string;
  end: string;
  asleepMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  coreMinutes: number;
  awakeMinutes: number;
  inBedMinutes: number;
  source: string;
}

/** Heart rate during a workout: local time HH:MM and average bpm of that minute. */
export interface HeartRatePoint {
  time: string;
  bpm: number;
}

/** A workout as recorded by one source app, before duplicates are merged. */
export interface HealthWorkout {
  id: string;
  /** Source app as written by Health ("Google Health", "MERACH", ...). */
  source: string;
  /** Workout name as written by Health ("Interno Ciclismo", ...). */
  name: string;
  date: string;
  start: string;
  end: string;
  kcal: number | null;
  distanceKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  heartRate: HeartRatePoint[];
}

export interface HealthExport {
  daily: HealthDailyValue[];
  sleep: HealthSleep[];
  workouts: HealthWorkout[];
  /** What the export contained but Intake does not import (for the import preview). */
  ignored: {
    /** HAE metric names that are not imported (nutrition, weight, ...). */
    metrics: string[];
    /** Top-level sections that are not imported (stateOfMind, medications, ...), with their entry count. */
    sections: Record<string, number>;
    /** Workouts whose GPS route was dropped. */
    routes: number;
  };
}

const DAILY_METRICS: Record<string, HealthMetric> = {
  step_count: "steps",
  walking_running_distance: "distanceKm",
  active_energy: "activeKcal",
  basal_energy_burned: "restingKcal",
  resting_heart_rate: "restingHr",
};

const KJ_PER_KCAL = 4.184;
const KM_PER_MILE = 1.609344;

/** "2026-10-26 07:39:00 +0100" → "2026-10-26T07:39:00+01:00"; ISO strings pass through. */
export function toIso(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(timestamp.trim());
  if (!match) return timestamp.trim();
  return `${match[1]}T${match[2]}${match[3]}${match[4]}:${match[5]}`;
}

/** Local date (YYYY-MM-DD) written in the timestamp, i.e. the day on the phone. */
const localDate = (timestamp: string) => timestamp.trim().slice(0, 10);
/** Local time (HH:MM) written in the timestamp. */
const localTime = (timestamp: string) => toIso(timestamp).slice(11, 16);

function toKcal(qty: number, units: string): number | null {
  const unit = units.toLowerCase();
  if (unit === "kcal") return qty;
  if (unit === "kj") return qty / KJ_PER_KCAL;
  return null;
}

function toKm(qty: number, units: string): number | null {
  const unit = units.toLowerCase();
  if (unit === "km") return qty;
  if (unit === "m") return qty / 1000;
  if (unit === "mi") return qty * KM_PER_MILE;
  return null;
}

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const hoursToMinutes = (hours: number) => Math.round(hours * 60);

function dailyValue(metric: HealthMetric, qty: number, units: string): number | null {
  switch (metric) {
    case "steps":
      return Math.round(qty);
    case "distanceKm": {
      const km = toKm(qty, units);
      return km === null ? null : round(km, 3);
    }
    case "activeKcal":
    case "restingKcal": {
      const kcal = toKcal(qty, units);
      return kcal === null ? null : round(kcal, 1);
    }
    case "restingHr":
      return round(qty, 1);
  }
}

function parseWorkout(input: unknown, warnings: string[]): { workout: HealthWorkout; hadRoute: boolean } | null {
  const parsed = workoutSchema.safeParse(input);
  if (!parsed.success) {
    warnings.push(`workout skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return null;
  }
  const w = parsed.data;
  const energy = w.activeEnergyBurned ? toKcal(w.activeEnergyBurned.qty, w.activeEnergyBurned.units) : null;
  if (w.activeEnergyBurned && energy === null) warnings.push(`workout ${w.id}: unknown energy unit "${w.activeEnergyBurned.units}"`);
  const distance = w.distance ? toKm(w.distance.qty, w.distance.units) : null;
  if (w.distance && distance === null) warnings.push(`workout ${w.id}: unknown distance unit "${w.distance.units}"`);
  const hrAvg = w.avgHeartRate?.qty ?? w.heartRate?.avg?.qty ?? null;
  const hrMax = w.maxHeartRate?.qty ?? w.heartRate?.max?.qty ?? null;
  const heartRate = w.heartRateData.flatMap((point) => {
    const p = heartRatePointSchema.safeParse(point);
    return p.success ? [{ time: localTime(p.data.date), bpm: Math.round(p.data.Avg) }] : [];
  });
  return {
    workout: {
      id: w.id,
      source: w.source?.name ?? "",
      name: w.name.trim(),
      date: localDate(w.start),
      start: toIso(w.start),
      end: toIso(w.end),
      kcal: energy === null ? null : round(energy, 1),
      distanceKm: distance === null || distance === 0 ? null : round(distance, 3),
      hrAvg: hrAvg === null ? null : Math.round(hrAvg),
      hrMax: hrMax === null ? null : Math.round(hrMax),
      heartRate,
    },
    hadRoute: (w.route?.length ?? 0) > 0,
  };
}

/** Parses a Health Auto Export JSON document (already decoded with JSON.parse). */
export function parseHealthExport(input: unknown): Parsed<HealthExport> {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) throw new ParseError("Not a Health Auto Export file (missing data.metrics / data.workouts)");
  const warnings: string[] = [];
  const { metrics, workouts: rawWorkouts, ...rest } = parsed.data.data;

  const daily = new Map<string, HealthDailyValue>();
  const sleep = new Map<string, HealthSleep>();
  const ignoredMetrics = new Set<string>();

  for (const metric of metrics) {
    if (metric.name === "sleep_analysis") {
      for (const point of metric.data) {
        const p = sleepPointSchema.safeParse(point);
        if (!p.success) {
          warnings.push("sleep_analysis: entry without sleepStart/sleepEnd skipped");
          continue;
        }
        const night = p.data;
        // Durations are in hours in the default export; other units are not supported
        if (metric.units && metric.units !== "hr") warnings.push(`sleep_analysis: unexpected unit "${metric.units}"`);
        sleep.set(localDate(night.date), {
          date: localDate(night.date),
          start: toIso(night.sleepStart),
          end: toIso(night.sleepEnd),
          asleepMinutes: hoursToMinutes(night.totalSleep),
          deepMinutes: hoursToMinutes(night.deep),
          remMinutes: hoursToMinutes(night.rem),
          coreMinutes: hoursToMinutes(night.core),
          awakeMinutes: hoursToMinutes(night.awake),
          inBedMinutes: hoursToMinutes(night.inBed),
          source: night.source ?? "",
        });
      }
      continue;
    }
    const target = DAILY_METRICS[metric.name];
    if (!target) {
      ignoredMetrics.add(metric.name);
      continue;
    }
    for (const point of metric.data) {
      const p = pointSchema.safeParse(point);
      if (!p.success || p.data.qty === undefined) {
        warnings.push(`${metric.name}: entry without date/qty skipped`);
        continue;
      }
      const value = dailyValue(target, p.data.qty, metric.units);
      if (value === null) {
        warnings.push(`${metric.name}: unknown unit "${metric.units}"`);
        break;
      }
      const date = localDate(p.data.date);
      daily.set(`${date}|${target}`, { date, metric: target, value });
    }
  }

  const workouts: HealthWorkout[] = [];
  let routes = 0;
  for (const raw of rawWorkouts) {
    const result = parseWorkout(raw, warnings);
    if (!result) continue;
    workouts.push(result.workout);
    if (result.hadRoute) routes++;
  }

  const sections = Object.fromEntries(
    Object.entries(rest)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key, value]) => [key, (value as unknown[]).length]),
  );

  const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);
  return {
    value: {
      daily: [...daily.values()].sort((a, b) => byDate(a, b) || a.metric.localeCompare(b.metric)),
      sleep: [...sleep.values()].sort(byDate),
      workouts: workouts.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
      ignored: { metrics: [...ignoredMetrics].sort(), sections, routes },
    },
    warnings,
  };
}
