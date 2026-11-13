import type { HealthTrendDay, HealthTrendNight, HealthTrends } from "@intake/shared";
import type { HealthStore } from "../db/healthStore.js";
import type { HealthSleep } from "../parsers/healthAutoExport.js";
import { sourceLabel } from "./healthWorkouts.js";

export const TREND_PERIODS = [7, 30, 90] as const;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

/** Minutes from midnight of the wake-up day: a start on the evening before is negative (23:50 → -10). */
export function trendNight(s: HealthSleep): HealthTrendNight {
  const start = minutesOf(s.start) - (s.start.slice(0, 10) < s.date ? 1440 : 0);
  const end = minutesOf(s.end) - (s.end.slice(0, 10) < s.date ? 1440 : 0);
  return { start, end, asleep: s.asleepMinutes, deep: s.deepMinutes, rem: s.remMinutes, core: s.coreMinutes, awake: s.awakeMinutes };
}

function byMin<T>(items: T[], value: (item: T) => number, pick: "min" | "max"): T {
  return items.reduce((best, item) => ((pick === "min" ? value(item) < value(best) : value(item) > value(best)) ? item : best));
}

/** Sleep, steps and resting heart rate over the last `period` days ending today (docs/apple-health.md § Andamento › Salute). */
export function healthTrends(store: HealthStore, today: string, period: 7 | 30 | 90): HealthTrends {
  const from = addDays(today, -(period - 1));
  const previousFrom = addDays(from, -period);
  const daily = store.daily(previousFrom, today, ["steps", "distanceKm", "restingHr"]);
  const values = new Map(daily.map((d) => [`${d.metric}|${d.date}`, d.value]));
  const value = (metric: string, date: string) => values.get(`${metric}|${date}`) ?? null;
  const nights = store.sleep(from, today);
  const nightsByDate = new Map(nights.map((n) => [n.date, n]));

  const days: HealthTrendDay[] = Array.from({ length: period }, (_, i) => {
    const date = addDays(from, i);
    const night = nightsByDate.get(date);
    return { date, steps: value("steps", date), distanceKm: value("distanceKm", date), restingHr: value("restingHr", date), sleep: night ? trendNight(night) : null };
  });

  const slept = days.filter((d) => d.sleep !== null) as Array<HealthTrendDay & { sleep: HealthTrendNight }>;
  const sleep =
    slept.length === 0
      ? null
      : (() => {
          const shortest = byMin(slept, (d) => d.sleep.asleep, "min");
          const longest = byMin(slept, (d) => d.sleep.asleep, "max");
          return {
            nights: slept.length,
            averageAsleep: Math.round(average(slept.map((d) => d.sleep.asleep))),
            averageStart: Math.round(average(slept.map((d) => d.sleep.start))),
            averageEnd: Math.round(average(slept.map((d) => d.sleep.end))),
            shortest: { date: shortest.date, minutes: shortest.sleep.asleep },
            longest: { date: longest.date, minutes: longest.sleep.asleep },
            phases: {
              deep: Math.round(average(slept.map((d) => d.sleep.deep))),
              rem: Math.round(average(slept.map((d) => d.sleep.rem))),
              core: Math.round(average(slept.map((d) => d.sleep.core))),
              awake: Math.round(average(slept.map((d) => d.sleep.awake))),
            },
            under7h: slept.filter((d) => d.sleep.asleep < 420).length,
            afterMidnight: slept.filter((d) => d.sleep.start >= 0).length,
          };
        })();

  const stepDays = days.filter((d) => d.steps !== null && d.date !== today);
  const goal = store.settings().stepGoal;
  const bestSteps = stepDays.length ? byMin(stepDays, (d) => d.steps!, "max") : null;
  const steps = bestSteps
    ? {
        days: stepDays.length,
        average: Math.round(average(stepDays.map((d) => d.steps!))),
        atGoal: stepDays.filter((d) => d.steps! >= goal).length,
        best: { date: bestSteps.date, steps: bestSteps.steps! },
      }
    : null;

  const hrDays = days.filter((d) => d.restingHr !== null);
  const previousHr = Array.from({ length: period }, (_, i) => value("restingHr", addDays(previousFrom, i))).filter((v): v is number => v !== null);
  const minHr = hrDays.length ? byMin(hrDays, (d) => d.restingHr!, "min") : null;
  const heart = minHr
    ? {
        days: hrDays.length,
        average: Math.round(average(hrDays.map((d) => d.restingHr!)) * 10) / 10,
        min: { date: minHr.date, value: minHr.restingHr! },
        previousAverage: previousHr.length ? Math.round(average(previousHr) * 10) / 10 : null,
      }
    : null;

  const dates = store.dates();
  const firstDataDate = [dates.daily.steps[0], dates.daily.restingHr[0], dates.sleep[0]].filter(Boolean).sort()[0] ?? null;
  const latestNight = nights.at(-1) ?? null;

  return {
    today,
    from,
    period,
    firstDataDate,
    stepGoal: goal,
    source: latestNight?.source ? sourceLabel(latestNight.source) : null,
    days,
    sleep,
    steps,
    heart,
  };
}
