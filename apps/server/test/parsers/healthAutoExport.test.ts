import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/parsers/common.js";
import { parseHealthExport, toIso } from "../../src/parsers/healthAutoExport.js";
import { fixture } from "./fixtures.js";

const { value, warnings } = parseHealthExport(JSON.parse(fixture("health-auto-export.json")));
const day = (date: string) => Object.fromEntries(value.daily.filter((d) => d.date === date).map((d) => [d.metric, d.value]));

describe("Health Auto Export parser (real export, 23–30 Oct 2026)", () => {
  it("reads the file without warnings", () => {
    expect(warnings).toEqual([]);
  });

  it("keeps daily steps, distance, resting heart rate and energy, converting kJ to kcal", () => {
    // 26 Oct: first day after the DST change; active energy is missing (Fitbit stopped writing it)
    expect(day("2026-10-26")).toEqual({ steps: 4128, distanceKm: 2.528, restingHr: 63, restingKcal: 283.1 });
    // 25 Oct: 2950.46 kJ of active energy
    expect(day("2026-10-25")).toMatchObject({ activeKcal: 705.2 });
    // Fractional steps (two merged sources) are rounded
    expect(day("2026-10-24")).toMatchObject({ steps: 5913 });
  });

  it("assigns each night to the wake-up day, in minutes", () => {
    expect(value.sleep.map((s) => s.date)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(value.sleep[3]).toEqual({
      date: "2026-10-27",
      start: "2026-10-27T00:45:00+01:00",
      end: "2026-10-27T07:05:00+01:00",
      asleepMinutes: 373,
      deepMinutes: 85,
      remMinutes: 57,
      coreMinutes: 231,
      awakeMinutes: 7,
      inBedMinutes: 380,
      source: "Google Health",
    });
    // The night of the DST change keeps both offsets
    expect(value.sleep[1]).toMatchObject({ start: "2026-10-24T23:20:00+02:00", end: "2026-10-25T07:30:00+01:00", awakeMinutes: 127 });
  });

  it("reads workouts with kcal, distance and the heart rate recorded during the session", () => {
    expect(value.workouts).toHaveLength(17);
    const bike = value.workouts.find((w) => w.source === "MERACH")!;
    expect(bike).toMatchObject({
      name: "Interno Ciclismo",
      date: "2026-10-25",
      start: "2026-10-25T10:02:29+01:00",
      end: "2026-10-25T10:29:16+01:00",
      kcal: 240.4,
      distanceKm: 11.469,
      hrAvg: 114,
      hrMax: 165,
    });
    expect(bike.heartRate[0]).toEqual({ time: "10:02", bpm: 70 });
    expect(bike.heartRate).toHaveLength(28);
    // A Hevy workout written to Health without energy
    const hevy = value.workouts.find((w) => w.source === "Hevy")!;
    expect(hevy).toMatchObject({ date: "2026-10-24", kcal: 312.2, hrAvg: 95 });
  });

  it("lists what is not imported: nutrition, weight, all-day heart rate, mood, medications, routes", () => {
    expect(value.ignored).toEqual({
      metrics: ["dietary_energy", "heart_rate", "protein", "weight_body_mass"],
      sections: { stateOfMind: 1, medications: 1 },
      routes: 1,
    });
    expect(JSON.stringify(value)).not.toContain("latitude");
  });

  it("converts timestamps with offset to ISO", () => {
    expect(toIso("2026-10-26 07:39:00 +0100")).toBe("2026-10-26T07:39:00+01:00");
    expect(toIso("2026-11-04T07:45:11Z")).toBe("2026-11-04T07:45:11Z");
  });

  it("converts miles and kcal exports", () => {
    const parsed = parseHealthExport({
      data: {
        metrics: [
          { name: "walking_running_distance", units: "mi", data: [{ date: "2026-11-01 00:00:00 +0100", qty: 2 }] },
          { name: "active_energy", units: "kcal", data: [{ date: "2026-11-01 00:00:00 +0100", qty: 410 }] },
        ],
        workouts: [],
      },
    });
    expect(parsed.value.daily).toEqual([
      { date: "2026-11-01", metric: "activeKcal", value: 410 },
      { date: "2026-11-01", metric: "distanceKm", value: 3.219 },
    ]);
  });

  it("warns about unknown units instead of storing wrong values", () => {
    const parsed = parseHealthExport({
      data: { metrics: [{ name: "active_energy", units: "J", data: [{ date: "2026-11-01 00:00:00 +0100", qty: 1 }] }], workouts: [] },
    });
    expect(parsed.value.daily).toEqual([]);
    expect(parsed.warnings).toEqual(['active_energy: unknown unit "J"']);
  });

  it("rejects files that are not Health Auto Export exports", () => {
    expect(() => parseHealthExport({ meals: [] })).toThrow(ParseError);
  });
});
