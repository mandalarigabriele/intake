import type { HealthDay, HealthNight } from "@intake/shared";
import type { HealthStore } from "../db/healthStore.js";
import type { HealthSleep } from "../parsers/healthAutoExport.js";
import { sourceLabel } from "./healthWorkouts.js";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const range = (end: string, length: number) => Array.from({ length }, (_, i) => addDays(end, i - length + 1));
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function toNight(s: HealthSleep): HealthNight {
  return {
    date: s.date,
    bedtime: s.start.slice(11, 16),
    wake: s.end.slice(11, 16),
    asleepMinutes: s.asleepMinutes,
    deepMinutes: s.deepMinutes,
    remMinutes: s.remMinutes,
    coreMinutes: s.coreMinutes,
    awakeMinutes: s.awakeMinutes,
  };
}

/** Apple Health values of one day for the "Attività e riposo" card (docs/design § Today). */
export function healthDay(store: HealthStore, date: string, today: string): HealthDay {
  const from = addDays(date, -13);
  const daily = store.daily(from, date);
  const value = (metric: string, day: string) => daily.find((d) => d.metric === metric && d.date === day)?.value ?? null;
  const nights = store.sleep(addDays(date, -6), date);
  const night = nights.find((n) => n.date === date) ?? null;

  const stepsBefore = range(addDays(date, -1), 7).flatMap((d) => (value("steps", d) === null ? [] : [value("steps", d)!]));
  const hrLastWeek = range(addDays(date, -7), 7).flatMap((d) => (value("restingHr", d) === null ? [] : [value("restingHr", d)!]));
  const stepsAverage = average(stepsBefore);
  const hrAverage = average(hrLastWeek);

  const lastImport = store.imports(1)[0];
  const dates = store.dates();
  const lastDataDate = [dates.daily.steps.at(-1), dates.sleep.at(-1), dates.daily.restingHr.at(-1)].filter(Boolean).sort().at(-1) ?? null;
  const latestNight = night ?? nights.at(-1) ?? null;

  return {
    date,
    today,
    connected: lastImport !== undefined,
    steps: value("steps", date),
    distanceKm: value("distanceKm", date),
    stepsAverage: stepsAverage === null ? null : Math.round(stepsAverage),
    stepsSeries: range(date, 7).map((d) => ({ date: d, value: value("steps", d) })),
    sleep: night ? toNight(night) : null,
    sleepSeries: range(date, 7).map((d) => ({ date: d, minutes: nights.find((n) => n.date === d)?.asleepMinutes ?? null })),
    restingHr: value("restingHr", date),
    restingHrLastWeek: hrAverage === null ? null : Math.round(hrAverage),
    restingHrSeries: range(date, 8).map((d) => ({ date: d, value: value("restingHr", d) })),
    source: latestNight?.source ? sourceLabel(latestNight.source) : null,
    lastImportAt: lastImport?.receivedAt ?? null,
    lastDataDate,
  };
}
