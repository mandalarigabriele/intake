import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HevyError } from "../src/hevy/hevyApi.js";
import { hevyRoutinePageSchema, hevyWorkoutPageSchema } from "../src/parsers/hevy.js";
import type { TrainingRoutesOptions } from "../src/routes/training.js";
import type { MergedWorkout } from "../src/services/healthWorkouts.js";
import { buildTraining, nextWeight, routineLetter, rotationOf } from "../src/services/training.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const routines = hevyRoutinePageSchema.parse(JSON.parse(fixture("hevy-routines.json"))).routines;
const workouts = hevyWorkoutPageSchema.parse(JSON.parse(fixture("hevy-workouts-history.json"))).workouts;
const view = () => buildTraining({ routines, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-13" });

describe("Hevy routines", () => {
  it("parses real routines with rep ranges and supersets", () => {
    expect(routines.map((r) => r.title)).toEqual([
      "Full Body C — Split Squat + Croci + Cavi",
      "Full Body B — Catena posteriore + Schiena",
      "Full Body A — Squat + Panca",
    ]);
    const squat = routines[2]!.exercises[0]!;
    expect(squat.title).toBe("Squat (Barbell)");
    expect(squat.sets[1]).toMatchObject({ type: "normal", weight_kg: 53.5, rep_range: { start: 6, end: 8 } });
  });

  it("orders the rotation A → B → C and reads the letter from the title", () => {
    expect(rotationOf(routines, workouts).map((r) => routineLetter(r.title, 0))).toEqual(["A", "B", "C"]);
    expect(routineLetter("Upper body", 1)).toBe("B");
    expect(nextWeight(53.5, "Panca Piana (Bilanciere)")).toBe(56);
    expect(nextWeight(40, "Incline Bench Press (Dumbbell)")).toBe(42);
  });
});

describe("buildTraining", () => {
  it("proposes the routine after the last one done, with targets and hints", () => {
    const next = view().next!;
    expect(next).toMatchObject({ title: "Full Body A — Squat + Panca", letter: "A", exerciseCount: 7, after: { title: "Full Body C — Split Squat + Croci + Cavi", date: "2026-11-13" } });
    // Titles as logged in Hevy (Italian), the routine's English title only for exercises never done
    expect(next.exercises[0]).toMatchObject({ title: "Squat (Bilanciere)", templateTitle: "Squat (Barbell)", sets: 3, weights: [53.5, 63.5, 63.5], repRange: { start: 6, end: 8 } });
    // Bench: 53,5 kg × 10 on every working set last time, the top of 6–8 → try 56 kg
    expect(next.exercises[1]).toMatchObject({ title: "Panca Piana (Bilanciere)", suggestKg: 56 });
    expect(next.exercises.filter((e) => e.superset).map((e) => e.templateTitle)).toEqual(["Lateral Raise (Cable)", "Single Arm Triceps Pushdown (Cable)"]);
  });

  it("summarises the week with the routine letters and other activity from Apple Health", () => {
    const cycling = { label: "Cyclette", family: "Ciclismo", source: "MERACH", date: "2026-11-10", start: "2026-11-10T14:50:00+01:00", end: "2026-11-10T15:17:00+01:00", durationMinutes: 27, kcal: 253, distanceKm: 11.7, hrAvg: 135, hrMax: 145, heartRate: [], fromHevy: false, sources: [], heartRateFrom: "MERACH", kcalFrom: "MERACH", records: [], id: "h1" } as unknown as MergedWorkout;
    const strength = { ...cycling, id: "h2", label: "Forza", family: "Forza", source: "Google Health", date: "2026-11-12", start: "2026-11-12T18:00:00+01:00", end: "2026-11-12T18:40:00+01:00" } as unknown as MergedWorkout;
    const week = buildTraining({ routines, workouts, health: [cycling, strength], timeZone: "Europe/Rome", today: "2026-11-13" }).week;
    expect(week.days.map((d) => d.letter)).toEqual(["A", null, "B", null, "C", null, null]);
    expect(week).toMatchObject({ start: "2026-11-09", done: 3, total: 3, minutes: 142, exercises: 23 });
    expect(week.other).toEqual([{ type: "Cyclette", date: "2026-11-10", source: "MERACH" }]);
    expect(week.days[1]!.other).toBe("Cyclette 27 min");
  });

  it("charts the first two weighted exercises of each routine with the best set per session", () => {
    const lifts = view().lifts;
    expect(lifts.map((l) => l.title)).toEqual(["Squat (Bilanciere)", "Panca Piana (Bilanciere)", "Hip Thrust (Manubrio)", "Panca Inclinata (Manubrio)", "Affondo Bulgaro (Manubrio)", "Croci ai Cavi"]);
    const bench = lifts[1]!;
    expect(bench.points.at(-1)).toEqual({ date: "2026-11-09", weightKg: 53.5, reps: 10 });
    expect(bench.change).toEqual({ kind: "ready", suggestKg: 56 });
    expect(lifts[2]!.change).toEqual({ kind: "last", kg: 2 });
    expect(view().recent.map((r) => r.letter)).toEqual(["C", "B", "A", "C"]);
  });
});

describe("GET /api/training", () => {
  async function setup(hevy: TrainingRoutesOptions["hevy"]) {
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-13", localTime: "18:00:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), training: { hevy, api } });
    const { cookie } = await signIn(app);
    return (await app.inject({ method: "GET", url: "/api/training", headers: { cookie } })).json();
  }

  it("reads routines and about four months of workouts from Hevy", async () => {
    let since = "";
    const body = await setup({ routines: async () => routines, workoutsSince: async (s) => ((since = s), workouts) });
    expect(since).toBe("2026-07-16T00:00:00Z");
    expect(body).toMatchObject({ configured: true, next: { letter: "A" } });
  });

  it("is empty without HEVY_API_KEY and when Hevy does not answer", async () => {
    expect(await setup(null)).toMatchObject({ configured: false, next: null, lifts: [] });
    const down = await setup({ routines: async () => Promise.reject(new HevyError("down", 503)), workoutsSince: async () => workouts });
    expect(down).toMatchObject({ configured: true, hevyUnavailable: true, next: null });
  });
});
