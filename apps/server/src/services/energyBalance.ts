import type { WeekBalance } from "@intake/shared";
import type { HealthStore } from "../db/healthStore.js";

/**
 * Calories eaten (Nutrition) against calories burned (Apple Health: active + resting energy), docs/apple-health.md
 * § Balance. A day counts only when both energies arrived: no BMR formula ever fills a gap.
 */

export interface DayEnergy {
  activeKcal: number | null;
  restingKcal: number | null;
}

/** Active and resting energy per date (kcal, rounded) from the stored daily values. */
export function energyByDate(store: Pick<HealthStore, "daily">, from: string, to: string): Map<string, DayEnergy> {
  const byDate = new Map<string, DayEnergy>();
  for (const value of store.daily(from, to, ["activeKcal", "restingKcal"])) {
    const day = byDate.get(value.date) ?? { activeKcal: null, restingKcal: null };
    if (value.metric === "activeKcal") day.activeKcal = Math.round(value.value);
    if (value.metric === "restingKcal") day.restingKcal = Math.round(value.value);
    byDate.set(value.date, day);
  }
  return byDate;
}

/** Burned = active + resting, only when both are there (resting energy is never estimated). */
export const burned = (day: DayEnergy | undefined): number | null =>
  day && day.activeKcal !== null && day.restingKcal !== null && day.restingKcal > 0 ? day.activeKcal + day.restingKcal : null;

/**
 * The week's balance: per day eaten, active, resting and net (eaten − burned; negative = deficit). Totals use finished
 * days with meals and both energies. Null when no day of the week has both energies.
 */
export function weekBalance(days: Array<{ date: string; kcal: number | null }>, energy: Map<string, DayEnergy>, today: string): WeekBalance | null {
  const rows = days.map((d) => {
    const e = energy.get(d.date);
    const out = burned(e);
    return {
      date: d.date,
      eatenKcal: d.kcal === null ? null : Math.round(d.kcal),
      activeKcal: e?.activeKcal ?? null,
      restingKcal: e?.restingKcal ?? null,
      burnedKcal: out,
      net: out !== null && d.kcal !== null ? Math.round(d.kcal) - out : null,
      complete: d.date < today,
    };
  });
  if (!rows.some((r) => r.burnedKcal !== null)) return null;
  const counted = rows.filter((r) => r.complete && r.net !== null);
  const sum = (pick: (r: (typeof rows)[number]) => number) => counted.reduce((total, r) => total + pick(r), 0);
  return {
    days: rows,
    total: counted.length
      ? { days: counted.length, eatenKcal: sum((r) => r.eatenKcal!), burnedKcal: sum((r) => r.burnedKcal!), net: sum((r) => r.net!) }
      : null,
  };
}
