import type { DailyScores, RecoveryPart } from "@intake/shared";
import type { HealthStore } from "../db/healthStore.js";
import { mergeWorkouts, sourceLabel } from "./healthWorkouts.js";

/**
 * Sforzo, Recupero and Sonno as percentages (docs/apple-health.md § Daily scores). Read from SQLite only.
 * Data written by Apple Health devices wins when present (HRV, active energy); otherwise the scores are
 * estimated from what Fitbit and the other apps write (resting HR, respiratory rate, steps, workouts).
 */

const BASELINE_DAYS = 30;
const MIN_BASELINE_DAYS = 5;
const SLEEP_NEED_MINUTES = 480;
/** Load at which Sforzo reaches about 63%; a 50-minute moderate workout plus a normal day of walking is around 60%. */
const LOAD_SCALE = 60;
const DEFAULT_MAX_HR = 185;
const DEFAULT_RESTING_HR = 60;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Banister TRIMP: minutes × heart-rate reserve × 0.64·e^(1.92·reserve). */
export function trimp(minutes: number, reserve: number): number {
  const r = clamp(reserve, 0, 1);
  return minutes * r * 0.64 * Math.exp(1.92 * r);
}

export function effortPercent(load: number): number {
  return Math.round(100 * (1 - Math.exp(-load / LOAD_SCALE)));
}

/** Sleep need: 8 hours, plus up to 30 minutes after a hard day (yesterday's Sforzo above 50%). */
/** Minutes from midnight of the wake-up day for a sleep start (negative = the evening before). */
const startMinutes = (start: string, wakeDate: string) =>
  Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)) - (start.slice(0, 10) < wakeDate ? 1440 : 0);

/** One point off for every 10 minutes beyond 45 away from the usual bedtime, at most 10 (needs 3 earlier nights). */
export function regularityPenalty(start: number, usualStarts: number[]): number {
  if (usualStarts.length < 3) return 0;
  const gap = Math.abs(start - mean(usualStarts));
  return Math.min(10, Math.max(0, Math.floor((gap - 45) / 10) + (gap > 45 ? 1 : 0)));
}

export function sleepNeed(previousEffort: number | null): number {
  return SLEEP_NEED_MINUTES + (previousEffort !== null && previousEffort > 50 ? Math.round(((previousEffort - 50) / 50) * 30) : 0);
}

function effortOf(store: Pick<HealthStore, "daily" | "workouts">, date: string, values: (metric: string, day: string) => number | null) {
  const sessions = mergeWorkouts(store.workouts(addDays(date, -90), date));
  const day = sessions.filter((w) => w.date === date);
  const steps = values("steps", date);
  const active = values("activeKcal", date);
  if (day.length === 0 && steps === null && active === null) return null;

  const observedMax = Math.max(0, ...sessions.map((w) => w.hrMax ?? 0));
  const max = Math.max(DEFAULT_MAX_HR, observedMax);
  const resting = values("restingHr", date) ?? DEFAULT_RESTING_HR;
  const workouts = day.map((w) => {
    // Without heart rate: a moderate intensity, a little lower for strength sessions
    const reserve = w.hrAvg !== null ? (w.hrAvg - resting) / (max - resting) : w.family === "Forza" ? 0.4 : 0.5;
    return { title: w.label, minutes: w.durationMinutes, hrAvg: w.hrAvg, load: round1(trimp(w.durationMinutes, reserve)) };
  });
  // Moving around outside workouts: the larger of steps and active energy (minus the workouts' kcal). A watch that
  // writes active energy all day wins; partial active energy (e.g. only workouts) does not hide the steps
  const workoutKcal = day.reduce((sum, w) => sum + (w.kcal ?? 0), 0);
  const fromSteps = { from: "steps" as const, value: steps ?? 0, load: round1(((steps ?? 0) / 1000) * 1.5) };
  const fromActive = active !== null ? { from: "activeEnergy" as const, value: Math.round(active), load: round1(Math.max(0, active - workoutKcal) / 10) } : null;
  const movement = fromActive && fromActive.load > fromSteps.load ? fromActive : fromSteps;
  const load = workouts.reduce((sum, w) => sum + w.load, 0) + movement.load;
  return { percent: effortPercent(load), workouts, movement, hrRange: { resting: Math.round(resting), max: Math.round(max) } };
}

/** A value equal to the personal baseline scores 65; `gain` sets how fast a relative change moves it away. */
const NEUTRAL_SCORE = 65;
function partScore(value: number, baseline: number, gain: number, higherIsBetter: boolean): number {
  const change = (value - baseline) / baseline;
  return Math.round(clamp(NEUTRAL_SCORE + (higherIsBetter ? change : -change) * gain));
}

export function dailyScores(store: Pick<HealthStore, "daily" | "workouts" | "sleep" | "imports">, date: string, today: string): DailyScores {
  const from = addDays(date, -BASELINE_DAYS);
  const daily = store.daily(addDays(from, -1), date);
  const map = new Map(daily.map((d) => [`${d.metric}|${d.date}`, d.value]));
  const values = (metric: string, day: string) => map.get(`${metric}|${day}`) ?? null;
  const baseline = (metric: string) => {
    const history = Array.from({ length: BASELINE_DAYS }, (_, i) => values(metric, addDays(from, i))).filter((v): v is number => v !== null);
    return history.length >= MIN_BASELINE_DAYS ? mean(history) : null;
  };

  const effort = effortOf(store, date, values);
  const previous = effortOf(store, addDays(date, -1), values);

  const nights = store.sleep(addDays(date, -7), date);
  const night = nights.find((n) => n.date === date) ?? null;
  const need = sleepNeed(previous?.percent ?? null);
  const sleep = night
    ? (() => {
        const usual = nights.filter((n) => n.date < date).map((n) => startMinutes(n.start, n.date));
        const penalty = regularityPenalty(startMinutes(night.start, night.date), usual);
        return {
          percent: Math.max(0, Math.min(100, Math.round((night.asleepMinutes / need) * 100)) - penalty),
          asleepMinutes: night.asleepMinutes,
          needMinutes: need,
          bedtime: night.start.slice(11, 16),
          wake: night.end.slice(11, 16),
          regularityPenalty: penalty,
        };
      })()
    : null;

  // Recupero: HRV leads when a watch writes it; resting HR, respiratory rate and sleep complete it
  const parts: RecoveryPart[] = [];
  const hrv = values("hrvMs", date);
  const hrvBase = baseline("hrvMs");
  const rhr = values("restingHr", date);
  const rhrBase = baseline("restingHr");
  const resp = values("respiratoryRate", date);
  const respBase = baseline("respiratoryRate");
  const usesHrv = hrv !== null && hrvBase !== null;
  const weights = usesHrv ? { hrv: 0.5, restingHr: 0.2, respiratoryRate: 0, sleep: 0.3 } : { hrv: 0, restingHr: 0.45, respiratoryRate: 0.2, sleep: 0.35 };
  if (usesHrv) parts.push({ key: "hrv", value: hrv, baseline: round1(hrvBase), score: partScore(hrv, hrvBase, 200, true), weight: weights.hrv });
  if (rhr !== null && rhrBase !== null) parts.push({ key: "restingHr", value: rhr, baseline: round1(rhrBase), score: partScore(rhr, rhrBase, 300, false), weight: weights.restingHr });
  if (resp !== null && respBase !== null && weights.respiratoryRate > 0) {
    parts.push({ key: "respiratoryRate", value: resp, baseline: round1(respBase), score: partScore(resp, respBase, 300, false), weight: weights.respiratoryRate });
  }
  if (sleep) parts.push({ key: "sleep", value: sleep.asleepMinutes, baseline: null, score: sleep.percent, weight: weights.sleep });
  const heartPart = parts.some((p) => p.key === "hrv" || p.key === "restingHr");
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  for (const p of parts) p.weight = totalWeight > 0 ? Math.round((p.weight / totalWeight) * 100) / 100 : 0;
  const hasAnyInput = hrv !== null || rhr !== null || sleep !== null;
  const recovery = hasAnyInput
    ? { percent: heartPart ? Math.round(parts.reduce((sum, p) => sum + p.score * p.weight, 0)) : null, parts, usesHrv }
    : null;

  const sources = new Set<string>();
  if (night?.source) sources.add(sourceLabel(night.source));
  for (const w of mergeWorkouts(store.workouts(date, date))) sources.add(w.source);

  return { date, today, connected: store.imports(1).length > 0, effort, recovery, sleep, sources: [...sources] };
}
