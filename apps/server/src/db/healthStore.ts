import type { HealthSettings } from "@intake/shared";
import type { DatabaseSync } from "node:sqlite";
import type { HealthDailyValue, HealthExport, HealthMetric, HealthSleep, HealthWorkout } from "../parsers/healthAutoExport.js";

export type HealthImportKind = "file" | "sync";

/** What an import adds and changes, computed before writing (preview) or after (result). */
export interface HealthImportCounts {
  firstDate: string | null;
  lastDate: string | null;
  /** Distinct days with at least one daily value or night. */
  days: number;
  newDays: number;
  updatedDays: number;
  workouts: number;
  newWorkouts: number;
}

export interface HealthImportRecord {
  id: number;
  kind: HealthImportKind;
  receivedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  counts: HealthImportCounts;
}

interface WorkoutRow {
  id: string;
  source: string;
  name: string;
  date: string;
  start: string;
  end: string;
  kcal: number | null;
  distance_km: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  heart_rate: string;
}

interface SleepRow {
  date: string;
  start: string;
  end: string;
  asleep_minutes: number;
  deep_minutes: number;
  rem_minutes: number;
  core_minutes: number;
  awake_minutes: number;
  in_bed_minutes: number;
  source: string;
}

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = { stepGoal: 8000 };
const SETTINGS_KEY = "health";

function exportDays(data: HealthExport): string[] {
  return [...new Set([...data.daily.map((d) => d.date), ...data.sleep.map((s) => s.date)])].sort();
}

/**
 * Apple Health data in SQLite: the only data Intake stores instead of reading it live,
 * because Health cannot be queried from the server. Every write is an upsert: the current
 * day arrives partial and is sent again, and re-importing a period never duplicates rows.
 */
export class HealthStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Counts for an import without writing anything (used for the preview and the result). */
  counts(data: HealthExport): HealthImportCounts {
    const days = exportDays(data);
    const knownDay = this.db.prepare("SELECT 1 FROM health_daily WHERE date = ? UNION SELECT 1 FROM health_sleep WHERE date = ? LIMIT 1");
    const knownWorkout = this.db.prepare("SELECT 1 FROM health_workouts WHERE id = ?");
    const existingDays = days.filter((day) => knownDay.get(day, day) !== undefined).length;
    const existingWorkouts = data.workouts.filter((w) => knownWorkout.get(w.id) !== undefined).length;
    return {
      firstDate: days[0] ?? null,
      lastDate: days.at(-1) ?? null,
      days: days.length,
      newDays: days.length - existingDays,
      updatedDays: existingDays,
      workouts: data.workouts.length,
      newWorkouts: data.workouts.length - existingWorkouts,
    };
  }

  /** Writes an import in one transaction and logs it. Returns the counts as they were before writing. */
  save(data: HealthExport, kind: HealthImportKind): HealthImportCounts {
    const counts = this.counts(data);
    const daily = this.db.prepare(
      `INSERT INTO health_daily (date, metric, value) VALUES (?, ?, ?)
       ON CONFLICT(date, metric) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    );
    const sleep = this.db.prepare(
      `INSERT INTO health_sleep (date, start, end, asleep_minutes, deep_minutes, rem_minutes, core_minutes, awake_minutes, in_bed_minutes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET start = excluded.start, end = excluded.end, asleep_minutes = excluded.asleep_minutes,
         deep_minutes = excluded.deep_minutes, rem_minutes = excluded.rem_minutes, core_minutes = excluded.core_minutes,
         awake_minutes = excluded.awake_minutes, in_bed_minutes = excluded.in_bed_minutes, source = excluded.source,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    );
    const workout = this.db.prepare(
      `INSERT INTO health_workouts (id, source, name, date, start, end, kcal, distance_km, hr_avg, hr_max, heart_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source = excluded.source, name = excluded.name, date = excluded.date, start = excluded.start,
         end = excluded.end, kcal = excluded.kcal, distance_km = excluded.distance_km, hr_avg = excluded.hr_avg,
         hr_max = excluded.hr_max, heart_rate = excluded.heart_rate, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    );
    const log = this.db.prepare("INSERT INTO health_imports (kind, first_date, last_date, summary) VALUES (?, ?, ?, ?)");

    this.db.exec("BEGIN");
    try {
      for (const d of data.daily) daily.run(d.date, d.metric, d.value);
      for (const s of data.sleep) {
        sleep.run(s.date, s.start, s.end, s.asleepMinutes, s.deepMinutes, s.remMinutes, s.coreMinutes, s.awakeMinutes, s.inBedMinutes, s.source);
      }
      for (const w of data.workouts) {
        workout.run(w.id, w.source, w.name, w.date, w.start, w.end, w.kcal, w.distanceKm, w.hrAvg, w.hrMax, JSON.stringify(w.heartRate));
      }
      log.run(kind, counts.firstDate, counts.lastDate, JSON.stringify(counts));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return counts;
  }

  /** Daily values between two dates (inclusive), optionally for some metrics only. */
  daily(from: string, to: string, metrics?: HealthMetric[]): HealthDailyValue[] {
    const rows = this.db
      .prepare("SELECT date, metric, value FROM health_daily WHERE date BETWEEN ? AND ? ORDER BY date, metric")
      .all(from, to) as unknown as HealthDailyValue[];
    return metrics ? rows.filter((row) => metrics.includes(row.metric)) : rows;
  }

  /** Nights whose wake-up day is between two dates (inclusive). */
  sleep(from: string, to: string): HealthSleep[] {
    const rows = this.db.prepare("SELECT * FROM health_sleep WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to) as unknown as SleepRow[];
    return rows.map((r) => ({
      date: r.date,
      start: r.start,
      end: r.end,
      asleepMinutes: r.asleep_minutes,
      deepMinutes: r.deep_minutes,
      remMinutes: r.rem_minutes,
      coreMinutes: r.core_minutes,
      awakeMinutes: r.awake_minutes,
      inBedMinutes: r.in_bed_minutes,
      source: r.source,
    }));
  }

  /** Raw workouts (before merging duplicates) starting between two dates (inclusive). */
  workouts(from: string, to: string): HealthWorkout[] {
    const rows = this.db
      .prepare("SELECT * FROM health_workouts WHERE date BETWEEN ? AND ? ORDER BY start")
      .all(from, to) as unknown as WorkoutRow[];
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name,
      date: r.date,
      start: r.start,
      end: r.end,
      kcal: r.kcal,
      distanceKm: r.distance_km,
      hrAvg: r.hr_avg,
      hrMax: r.hr_max,
      heartRate: JSON.parse(r.heart_rate) as HealthWorkout["heartRate"],
    }));
  }

  /** Dates that have a value for each daily metric, plus nights and workout days (sorted). */
  dates(): { daily: Record<HealthMetric, string[]>; sleep: string[]; workouts: string[] } {
    const daily: Record<HealthMetric, string[]> = { steps: [], distanceKm: [], activeKcal: [], restingKcal: [], restingHr: [] };
    const rows = this.db.prepare("SELECT date, metric FROM health_daily ORDER BY date").all() as Array<{ date: string; metric: HealthMetric }>;
    for (const row of rows) daily[row.metric]?.push(row.date);
    const column = (sql: string) => (this.db.prepare(sql).all() as Array<{ date: string }>).map((r) => r.date);
    return {
      daily,
      sleep: column("SELECT date FROM health_sleep ORDER BY date"),
      workouts: column("SELECT DISTINCT date FROM health_workouts ORDER BY date"),
    };
  }

  /** All raw workouts (merged on read by the caller). */
  allWorkouts(): HealthWorkout[] {
    const range = this.db.prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM health_workouts").get() as { first: string | null; last: string | null };
    return range.first && range.last ? this.workouts(range.first, range.last) : [];
  }

  settings(): HealthSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_HEALTH_SETTINGS };
    try {
      return { ...DEFAULT_HEALTH_SETTINGS, ...(JSON.parse(row.value) as Partial<HealthSettings>) };
    } catch {
      return { ...DEFAULT_HEALTH_SETTINGS };
    }
  }

  setSettings(settings: HealthSettings): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(settings));
  }

  /** Most recent imports first. */
  imports(limit = 10): HealthImportRecord[] {
    const rows = this.db
      .prepare("SELECT id, kind, received_at, first_date, last_date, summary FROM health_imports ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<{ id: number; kind: HealthImportKind; received_at: string; first_date: string | null; last_date: string | null; summary: string }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      receivedAt: r.received_at,
      firstDate: r.first_date,
      lastDate: r.last_date,
      counts: JSON.parse(r.summary) as HealthImportCounts,
    }));
  }
}
