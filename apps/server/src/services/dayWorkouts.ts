import type { Workout, WorkoutHeartRatePoint } from "@intake/shared";
import type { HeartRatePoint } from "../parsers/healthAutoExport.js";
import { toWorkout, type HevyWorkout } from "../parsers/hevy.js";
import type { MergedWorkout } from "./healthWorkouts.js";

/**
 * Hevy workouts (read live) together with the Apple Health sessions (duplicates already merged).
 * A Health session that is the same workout as a Hevy one only adds heart rate and kcal to it:
 * Hevy keeps the title, exercises and duration (docs/apple-health.md § Duplicate workouts).
 */

const localTime = (iso: string) => iso.slice(11, 16);

function overlapShare(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
}

const minuteOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Per-minute heart rate counted from the local start time (HH:MM), inside the workout only.
 * Health Auto Export points carry their local time of day; a session may cross midnight.
 */
export function heartRateCurve(points: HeartRatePoint[], start: string, durationMinutes: number): WorkoutHeartRatePoint[] {
  const byMinute = new Map<number, number>();
  const from = minuteOfDay(start);
  for (const point of points) {
    if (!/^\d{2}:\d{2}/.test(point.time)) continue;
    let minute = minuteOfDay(point.time) - from;
    if (minute < -60) minute += 24 * 60;
    if (minute < -1 || minute > durationMinutes + 1) continue;
    minute = Math.max(0, minute);
    if (!byMinute.has(minute)) byMinute.set(minute, Math.round(point.bpm));
  }
  return [...byMinute.entries()].sort((a, b) => a[0] - b[0]).map(([minute, bpm]) => ({ minute, bpm }));
}

/** A Health session matches a Hevy workout when they overlap by half of the shorter one and the session is strength or written by Hevy. */
function matches(hevy: HevyWorkout, session: MergedWorkout): number {
  if (!session.fromHevy && session.family !== "Forza") return 0;
  const share = overlapShare(Date.parse(hevy.start_time), Date.parse(hevy.end_time), Date.parse(session.start), Date.parse(session.end));
  return share >= 0.5 ? share : 0;
}

function fromHevy(raw: HevyWorkout, session: MergedWorkout | null, timeZone: string): Workout {
  const workout = toWorkout(raw, timeZone);
  const healthSources = (session?.sources ?? []).filter((s) => s.label !== "Hevy");
  return {
    ...workout,
    origin: "hevy",
    type: session?.label ?? "Forza",
    family: session?.family ?? "Forza",
    source: "Hevy",
    kcal: session?.kcal ?? null,
    distanceKm: null,
    hrAvg: session?.hrAvg ?? null,
    hrMax: session?.hrMax ?? null,
    heartRate: session ? heartRateCurve(session.heartRate, workout.start, workout.durationMinutes) : [],
    sources: [{ label: "Hevy", used: true }, ...healthSources],
    heartRateFrom: session?.heartRateFrom ?? null,
    kcalFrom: session?.kcalFrom ?? null,
  };
}

function fromHealth(session: MergedWorkout): Workout {
  return {
    id: `health-${session.id}`,
    origin: "health",
    title: session.label,
    type: session.label,
    family: session.family,
    date: session.date,
    start: localTime(session.start),
    end: localTime(session.end),
    durationMinutes: session.durationMinutes,
    exercises: [],
    sets: 0,
    volumeKg: 0,
    source: session.source,
    kcal: session.kcal,
    distanceKm: session.distanceKm,
    hrAvg: session.hrAvg,
    hrMax: session.hrMax,
    heartRate: heartRateCurve(session.heartRate, localTime(session.start), session.durationMinutes),
    sources: session.sources,
    heartRateFrom: session.heartRateFrom,
    kcalFrom: session.kcalFrom,
  };
}

/** Hevy and Health workouts of a range, each session once, oldest first. */
export function combineWorkouts(hevy: HevyWorkout[], sessions: MergedWorkout[], timeZone: string): Workout[] {
  const used = new Set<MergedWorkout>();
  const fromHevyApi = hevy.map((raw) => {
    let best: MergedWorkout | null = null;
    let bestShare = 0;
    for (const session of sessions) {
      if (used.has(session)) continue;
      const share = matches(raw, session);
      if (share > bestShare) [best, bestShare] = [session, share];
    }
    if (best) used.add(best);
    return fromHevy(raw, best, timeZone);
  });
  const healthOnly = sessions.filter((s) => !used.has(s)).map(fromHealth);
  return [...fromHevyApi, ...healthOnly].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
