import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { HealthStore } from "../src/db/healthStore.js";
import type { HealthDailyValue } from "../src/parsers/healthAutoExport.js";
import { burned, energyByDate, weekBalance } from "../src/services/energyBalance.js";
import { healthDay } from "../src/services/healthDay.js";

const values: HealthDailyValue[] = [
  // Mon 16: both energies
  { date: "2026-11-16", metric: "activeKcal", value: 612.4 },
  { date: "2026-11-16", metric: "restingKcal", value: 1850.2 },
  // Tue 17: active only (resting missing): no balance, never estimated
  { date: "2026-11-17", metric: "activeKcal", value: 281 },
  // Wed 18: both
  { date: "2026-11-18", metric: "activeKcal", value: 450 },
  { date: "2026-11-18", metric: "restingKcal", value: 1870 },
  // Thu 19 (today, partial)
  { date: "2026-11-19", metric: "activeKcal", value: 120 },
  { date: "2026-11-19", metric: "restingKcal", value: 700 },
];
const store = { daily: (from: string, to: string) => values.filter((v) => v.date >= from && v.date <= to) };

describe("eaten against burned", () => {
  it("sums active and resting energy only when both arrived", () => {
    const energy = energyByDate(store, "2026-11-16", "2026-11-22");
    expect(energy.get("2026-11-16")).toEqual({ activeKcal: 612, restingKcal: 1850 });
    expect(burned(energy.get("2026-11-16"))).toBe(2462);
    expect(burned(energy.get("2026-11-17"))).toBeNull();
    expect(burned(energy.get("2026-11-20"))).toBeNull();
  });

  it("builds the week: net per day, totals over finished days with both sides", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((date, i) => ({
      date,
      kcal: i < 4 ? [2050, 1900, 2500, 900][i]! : null,
    }));
    const week = weekBalance(days, energyByDate(store, "2026-11-16", "2026-11-22"), "2026-11-19")!;
    expect(week.days[0]).toEqual({ date: "2026-11-16", eatenKcal: 2050, activeKcal: 612, restingKcal: 1850, burnedKcal: 2462, net: -412, complete: true });
    expect(week.days[1]).toMatchObject({ burnedKcal: null, net: null });
    expect(week.days[2]).toMatchObject({ burnedKcal: 2320, net: 180 });
    // Today is partial: it has a net but is not counted in the totals
    expect(week.days[3]).toMatchObject({ net: 80, complete: false });
    expect(week.total).toEqual({ days: 2, eatenKcal: 4550, burnedKcal: 4782, net: -232 });
  });

  it("is absent for a week without both energies", () => {
    const only = { daily: () => [{ date: "2026-11-17", metric: "activeKcal" as const, value: 281 }] };
    expect(weekBalance([{ date: "2026-11-17", kcal: 1900 }], energyByDate(only, "2026-11-16", "2026-11-22"), "2026-11-19")).toBeNull();
  });

  it("gives the day's energies and the 7-day resting average on the Health day", () => {
    const health = new HealthStore(openDatabase(":memory:"));
    health.save({ daily: values, sleep: [], workouts: [], ignored: { metrics: [], fields: [] }, warnings: [] } as never, "file");
    const day = healthDay(health, "2026-11-19", "2026-11-19");
    expect(day.energy).toEqual({ activeKcal: 120, restingKcal: 700, restingAverage: 1860 });
  });
});
