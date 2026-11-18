import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { HevySyncStore } from "../src/db/hevySyncStore.js";
import type { HevyWriteWorkout } from "../src/hevy/hevyApi.js";
import { hevyWorkoutPageSchema } from "../src/parsers/hevy.js";
import { openGymWorkouts, parseOpenGymState, type OpenGymState } from "../src/parsers/openGym.js";
import { contentHash, HevySync, hevyRpe, hevySet, learnExercises, newTemplate } from "../src/services/hevySync.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const stateBody = JSON.parse(fixture("opengym-state.json"));
const baseState = parseOpenGymState(stateBody);
const hevyHistory = hevyWorkoutPageSchema.parse(JSON.parse(fixture("hevy-workouts-history.json"))).workouts;

/** 18 Nov: a session logged only in openGym (the 13 Nov one again, five days later, plus an exercise never done in Hevy). */
const NOW = Date.parse("2026-11-18T12:00:00Z");
const latest = openGymWorkouts(baseState).find((w) => w.entries.length > 0)!;
const FIVE_DAYS = 5 * 86_400_000;
const newWorkout = {
  ...latest,
  id: "wk-new",
  d: "2026-11-18",
  start: latest.start + FIVE_DAYS,
  end: latest.end + FIVE_DAYS,
  entries: [...latest.entries, { id: "9999", sets: [{ w: 40, r: 12, done: true }, { w: 40, r: 12, done: true }] }],
};
const stateWithNew = (workout: object = newWorkout): OpenGymState => ({ ...baseState, workouts: { ...baseState.workouts, [newWorkout.id]: workout } });

function setup(state: OpenGymState = stateWithNew()) {
  const db = openDatabase(":memory:");
  const store = new HevySyncStore(db);
  const created: HevyWriteWorkout[] = [];
  const updated: Array<{ id: string; workout: HevyWriteWorkout }> = [];
  let current = state;
  const hevy = {
    workoutsSince: vi.fn(async () => hevyHistory),
    createWorkout: vi.fn(async (w: HevyWriteWorkout) => {
      created.push(w);
      return `hevy-${created.length}`;
    }),
    updateWorkout: vi.fn(async (id: string, w: HevyWriteWorkout) => void updated.push({ id, workout: w })),
    createExerciseTemplate: vi.fn(async () => "CUSTOM01"),
  };
  const openGym = {
    state: async () => current,
    exerciseNames: async () => new Map([["9999", "sled push"]]),
  };
  const log = { warn: vi.fn(), info: vi.fn() };
  const sync = new HevySync({ store, hevy, openGym, now: () => NOW, log });
  return { db, store, sync, hevy, created, updated, log, setState: (s: OpenGymState) => (current = s) };
}

describe("openGym → Hevy helpers", () => {
  it("learns the Hevy exercise of each openGym exercise from workouts present in both apps", () => {
    const learned = learnExercises(openGymWorkouts(baseState), hevyHistory, "kg");
    expect(learned.get("0043")).toEqual({ templateId: "TPL00016", title: "Squat (Bilanciere)" });
    expect(learned.get("0025")).toEqual({ templateId: "TPL00017", title: "Panca Piana (Bilanciere)" });
    expect(learned.get("imo0jisakymv")?.title).toBe("Landmine Romanian Deadlift");
    expect(learned.size).toBeGreaterThanOrEqual(25);
  });

  it("converts sets: warm-ups, pounds, RPE Hevy accepts, cardio minutes and distance", () => {
    expect(hevySet({ w: 20, r: 8, phase: "warmup", rpe: 8.2 }, "kg")).toEqual({ type: "warmup", weight_kg: 20, reps: 8, duration_seconds: null, distance_meters: null, rpe: 8 });
    expect(hevySet({ w: 100, r: 5 }, "lb").weight_kg).toBe(45.36);
    expect(hevySet({ min: 20, speed: 21 }, "kg")).toEqual({ type: "normal", weight_kg: null, reps: null, duration_seconds: 1200, distance_meters: 7000, rpe: null });
    expect([hevyRpe(null), hevyRpe(5), hevyRpe(6.4), hevyRpe(6.6), hevyRpe(9.8)]).toEqual([null, null, 6, 7, 10]);
  });

  it("describes a custom exercise from its name and sets", () => {
    expect(newTemplate("barbell hip thrust", [{ w: 60, r: 10 }])).toEqual({ title: "Barbell hip thrust", exercise_type: "weight_reps", equipment_category: "barbell", muscle_group: "other" });
    expect(newTemplate("stationary bike run v. 3", [{ min: 20, speed: 20 }])).toMatchObject({ exercise_type: "distance_duration", equipment_category: "machine", muscle_group: "cardio" });
  });
});

describe("openGym → Hevy copy", () => {
  it("plans only workouts not already in Hevy, with the Hevy exercise each one becomes", async () => {
    const { sync } = setup();
    const plan = await sync.plan();
    // Everything up to 13 Nov is already in Hevy (imported into openGym from there); the 17 Nov cycling has no done set
    expect(plan.items.map((i) => i.id)).toEqual(["wk-new"]);
    const item = plan.items[0]!;
    expect(item).toMatchObject({ action: "create", title: latest.name, minutes: 41 });
    expect(item.exercises[0]).toEqual({ name: expect.any(String), hevyTitle: "Affondo Bulgaro (Manubrio)", origin: "learned" });
    expect(item.exercises.at(-1)).toEqual({ name: "sled push", hevyTitle: null, origin: "new" });
  });

  it("does nothing while off", async () => {
    const { sync, hevy } = setup();
    await sync.run();
    expect(hevy.createWorkout).not.toHaveBeenCalled();
  });

  it("copies the workout once, creating the missing exercise, and updates it when it changes in openGym", async () => {
    const { sync, store, hevy, created, updated, setState } = setup();
    store.setEnabled(true);
    await sync.run();
    expect(hevy.createExerciseTemplate).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    const sent = created[0]!;
    expect(sent).toMatchObject({ title: latest.name, is_private: true, start_time: new Date(newWorkout.start).toISOString() });
    expect(sent.exercises[0]!.exercise_template_id).toBe("TPL00000");
    expect(sent.exercises[0]!.sets[0]!.type).toBe("warmup");
    expect(sent.exercises.at(-1)).toMatchObject({ exercise_template_id: "CUSTOM01", sets: [{ weight_kg: 40, reps: 12 }, { weight_kg: 40, reps: 12 }] });
    expect(store.links().get("wk-new")).toEqual({ openGymId: "wk-new", hevyId: "hevy-1", hash: contentHash(newWorkout) });
    expect(store.exerciseLinks().get("9999")).toMatchObject({ templateId: "CUSTOM01", origin: "custom" });
    expect(store.lastRun()).toMatchObject({ created: 1, updated: 0, error: null });

    // Nothing new: nothing sent (the copy now overlaps its own Hevy workout, which is linked, not a twin)
    hevy.workoutsSince.mockResolvedValue([...hevyHistory, { id: "hevy-1", title: latest.name, routine_id: null, start_time: sent.start_time, end_time: sent.end_time, exercises: [] }]);
    await sync.run();
    expect(created).toHaveLength(1);
    expect(updated).toHaveLength(0);

    // A set fixed in openGym: the Hevy copy is updated, the custom exercise is reused
    setState(stateWithNew({ ...newWorkout, entries: newWorkout.entries.map((e) => (e.id === "9999" ? { ...e, sets: [{ w: 45, r: 12, done: true }] } : e)) }));
    await sync.run();
    expect(updated).toHaveLength(1);
    expect(updated[0]!.id).toBe("hevy-1");
    expect(updated[0]!.workout.exercises.at(-1)!.sets).toEqual([expect.objectContaining({ weight_kg: 45, reps: 12 })]);
    expect(hevy.createExerciseTemplate).toHaveBeenCalledTimes(1);
  });

  it("records the error and keeps what was sent when Hevy fails", async () => {
    const { sync, store, hevy, log } = setup();
    store.setEnabled(true);
    hevy.createWorkout.mockRejectedValueOnce(new Error("Hevy answered 500"));
    await sync.run();
    expect(store.lastRun()).toMatchObject({ created: 0, error: "Hevy answered 500" });
    expect(store.links().size).toBe(0);
    expect(log.warn).toHaveBeenCalled();
    await sync.run();
    expect(store.links().get("wk-new")?.hevyId).toBe("hevy-1");
  });
});

describe("GET/PUT /api/hevy-sync", () => {
  it("is unavailable without both apps, and copies right away when turned on", async () => {
    const off = await buildApp({ auth: authOptions(), hevySync: { sync: null, store: new HevySyncStore(openDatabase(":memory:")) } });
    const offHeaders = { cookie: (await signIn(off)).cookie };
    expect((await off.inject({ method: "GET", url: "/api/hevy-sync", headers: offHeaders })).json()).toEqual({ available: false, enabled: false, lastRun: null, pending: null });
    expect((await off.inject({ method: "PUT", url: "/api/hevy-sync", headers: offHeaders, payload: { enabled: true } })).statusCode).toBe(409);

    const { sync, store, created } = setup();
    const app = await buildApp({ auth: authOptions(), hevySync: { sync, store } });
    const headers = { cookie: (await signIn(app)).cookie };
    const before = (await app.inject({ method: "GET", url: "/api/hevy-sync", headers })).json();
    expect(before).toMatchObject({ available: true, enabled: false, lastRun: null });
    expect(before.pending.map((i: { id: string }) => i.id)).toEqual(["wk-new"]);

    const on = (await app.inject({ method: "PUT", url: "/api/hevy-sync", headers, payload: { enabled: true } })).json();
    expect(on).toMatchObject({ enabled: true, lastRun: { created: 1, error: null } });
    expect(created).toHaveLength(1);
    expect((await app.inject({ method: "PUT", url: "/api/hevy-sync", headers, payload: { enabled: "yes" } })).statusCode).toBe(400);
  });
});
