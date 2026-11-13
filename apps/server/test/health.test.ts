import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { HealthStore } from "../src/db/healthStore.js";
import { parseHealthExport, type HealthWorkout } from "../src/parsers/healthAutoExport.js";
import { isSameSession, mergeWorkouts, sourceLabel, workoutType } from "../src/services/healthWorkouts.js";
import { fixture } from "./parsers/fixtures.js";

const exported = parseHealthExport(JSON.parse(fixture("health-auto-export.json"))).value;
const merged = mergeWorkouts(exported.workouts);
const on = (date: string, time: string) => merged.find((w) => w.date === date && w.start.slice(11, 16) === time);

describe("labels", () => {
  it("maps sources and workout names, keeping unknown ones", () => {
    expect(sourceLabel("Google Health")).toBe("Fitbit");
    expect(sourceLabel("Strava")).toBe("Strava");
    expect(workoutType("Interno Ciclismo")).toEqual({ label: "Cyclette", family: "Ciclismo" });
    expect(workoutType("Raquetball")).toEqual({ label: "Racchetta", family: "Racchetta" });
    expect(workoutType("Nuoto")).toEqual({ label: "Nuoto", family: "Nuoto" });
  });
});

describe("duplicate workouts (real cases)", () => {
  it("merges 17 records into 12 sessions", () => {
    expect(merged).toHaveLength(12);
  });

  it("24 Oct: Hevy wins on title, Fitbit gives heart rate and kcal", () => {
    expect(on("2026-10-24", "11:36")).toMatchObject({
      label: "Forza",
      source: "Hevy",
      fromHevy: true,
      end: "2026-10-24T12:57:38+02:00",
      kcal: 176,
      hrAvg: 97,
      hrMax: 135,
      sources: [
        { label: "Hevy", used: true },
        { label: "Fitbit", used: true },
      ],
    });
  });

  it("25 Oct: the MERACH bike and Fitbit's auto-detected ride are one Cyclette session", () => {
    expect(on("2026-10-25", "10:02")).toMatchObject({
      label: "Cyclette",
      source: "MERACH",
      end: "2026-10-25T10:30:39+01:00",
      durationMinutes: 28,
      distanceKm: 11.47,
      kcal: 177,
      fromHevy: false,
    });
    expect(on("2026-10-25", "10:04")).toBeUndefined();
  });

  it("26 Oct: Fitbit beats Bevel, which recalculates data already in Health", () => {
    expect(on("2026-10-26", "16:42")).toMatchObject({
      label: "Forza",
      source: "Fitbit",
      end: "2026-10-26T17:40:12+01:00",
      kcal: 240,
      sources: [
        { label: "Fitbit", used: true },
        { label: "Bevel", used: false },
      ],
    });
  });

  it("29 Oct: Fitbit's two pieces and Bevel are one session, 13:07–14:06, kcal summed", () => {
    const session = on("2026-10-29", "13:07")!;
    expect(session).toMatchObject({ source: "Fitbit", end: "2026-10-29T14:06:30+01:00", durationMinutes: 59, kcal: 126, hrMax: 141 });
    expect(session.heartRate.length).toBeGreaterThan(40);
    expect(merged.filter((w) => w.date === "2026-10-29")).toHaveLength(1);
  });

  it("keeps separate sessions of the same day apart", () => {
    expect(merged.filter((w) => w.date === "2026-10-25" && w.label === "Racchetta")).toHaveLength(2);
    expect(merged.filter((w) => w.date === "2026-10-27" && w.label === "Calcio")).toHaveLength(2);
  });

  it("needs the same family and an overlap of half the shorter session", () => {
    const w = (name: string, start: string, end: string): HealthWorkout => ({
      id: name + start,
      source: "Google Health",
      name,
      date: "2026-11-01",
      start: `2026-11-01T${start}:00+01:00`,
      end: `2026-11-01T${end}:00+01:00`,
      kcal: null,
      distanceKm: null,
      hrAvg: null,
      hrMax: null,
      heartRate: [],
    });
    // Overlap compared with the shorter session
    expect(isSameSession(w("Calcio", "18:00", "19:00"), w("Calcio", "18:20", "19:10"))).toBe(true); // 40 of 50 min
    expect(isSameSession(w("Calcio", "18:00", "19:00"), w("Calcio", "18:40", "19:20"))).toBe(true); // 20 of 40: exactly half
    expect(isSameSession(w("Calcio", "18:00", "19:00"), w("Calcio", "18:45", "19:30"))).toBe(false); // 15 of 45
    expect(isSameSession(w("Calcio", "18:00", "19:00"), w("Calcio", "19:00", "19:30"))).toBe(false); // touching, no overlap
    expect(isSameSession(w("Calcio", "18:00", "19:00"), w("Ciclismo", "18:00", "19:00"))).toBe(false);
  });
});

describe("HealthStore", () => {
  it("saves an import, reports new and updated days, and never duplicates on re-import", () => {
    const store = new HealthStore(openDatabase(":memory:"));
    const first = store.save(exported, "file");
    expect(first).toEqual({ firstDate: "2026-10-23", lastDate: "2026-10-30", days: 8, newDays: 8, updatedDays: 0, workouts: 17, newWorkouts: 17 });

    // The current day arrives again with a higher value: overwritten, not summed
    const again = {
      ...exported,
      daily: exported.daily.map((d) => (d.date === "2026-10-30" && d.metric === "steps" ? { ...d, value: 5000 } : d)),
    };
    expect(store.save(again, "sync")).toMatchObject({ days: 8, newDays: 0, updatedDays: 8, newWorkouts: 0 });
    expect(store.daily("2026-10-30", "2026-10-30", ["steps"])).toEqual([{ date: "2026-10-30", metric: "steps", value: 5000 }]);
    expect(store.workouts("2026-10-23", "2026-10-30")).toHaveLength(17);
    expect(store.imports().map((i) => i.kind)).toEqual(["sync", "file"]);
  });

  it("reads back nights and workouts as they were imported", () => {
    const store = new HealthStore(openDatabase(":memory:"));
    store.save(exported, "file");
    expect(store.sleep("2026-10-27", "2026-10-27")).toEqual(exported.sleep.filter((s) => s.date === "2026-10-27"));
    expect(store.workouts("2026-10-25", "2026-10-25")).toEqual(exported.workouts.filter((w) => w.date === "2026-10-25"));
    expect(mergeWorkouts(store.workouts("2026-10-23", "2026-10-30"))).toEqual(merged);
  });
});
