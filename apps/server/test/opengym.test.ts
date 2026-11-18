import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { OpenGymApi, OpenGymError } from "../src/opengym/openGymApi.js";
import { muscleBalanceSchema, openGymWorkouts, parseOpenGymState, previewSchema, weekPlanSchema } from "../src/parsers/openGym.js";
import { fromOpenGym, GymSources, hevySource, openGymSource } from "../src/services/gymSource.js";
import type { MergedWorkout } from "../src/services/healthWorkouts.js";
import { buildOpenGymTraining, cardioFamily, healthCoveredRoutines, nextPlannedDate, openGymLetter, plannedAfter } from "../src/services/openGymTraining.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const stateBody = JSON.parse(fixture("opengym-state.json"));
const state = parseOpenGymState(stateBody);
const tools = JSON.parse(fixture("opengym-mcp.json"));
const plan = weekPlanSchema.parse(tools.get_week_plan);
const preview = previewSchema.parse(tools.preview_session);
const muscles = muscleBalanceSchema.parse(tools.muscle_balance);
const names = new Map<string, string>(tools.get_workout.entries.map((e: { id: string; name: string }) => [e.id, e.name]));

/** A fetch that answers like openGym: the state, and MCP tool calls from the fixtures. */
function fakeFetch(calls: string[] = []) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ogt_test");
    if (path === "/api/token/data") return new Response(JSON.stringify(stateBody));
    const body = JSON.parse(String(init?.body));
    calls.push(body.params.name);
    const result = body.params.name === "get_routine" ? tools.get_routine[body.params.arguments.routine_id] : tools[body.params.name];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } }));
  }) as unknown as typeof fetch;
}

describe("openGym parsers", () => {
  it("reads the real state, week plan and session preview", () => {
    expect(state.routines.map((r) => r.name)).toEqual(["2 · Unilaterale & Cavi", "3 · Glutei & Spalle", "1 · Forza — Squat & Panca", "Cyclette — Zona 2"]);
    expect(plan.days[0]).toMatchObject({ date: "2026-11-17", routine_names: ["Cyclette — Zona 2"] });
    expect(preview).toMatchObject({ date: "2026-11-18", routine_name: "1 · Forza — Squat & Panca" });
    expect(muscles.neglected.map((m) => m.slug)).toEqual(["hip-flexors", "tibialis"]);
    const workouts = openGymWorkouts(state);
    expect(workouts[0]!.start).toBeGreaterThan(workouts[1]!.start);
  });

  it("reads a partial state field by field (a view-only token returns fewer categories)", () => {
    const partial = parseOpenGymState({ state: { routines: [{ id: "r1", name: "1 · Forza" }, { broken: true }], workouts: [{ id: "w1", d: "2026-11-17" }], week: "n/a" }, rev: 3 });
    expect(partial.routines.map((r) => r.name)).toEqual(["1 · Forza"]);
    expect(Object.keys(partial.workouts)).toEqual(["w1"]);
    expect(partial).toMatchObject({ unit: "kg", week: null, customEx: null });
    expect(() => parseOpenGymState({ error: "scope" })).toThrow();
    // customEx as a list, as a view-only token returns it
    expect(parseOpenGymState({ state: { customEx: [{ id: "c1", n: "landmine romanian deadlift" }] } }).customEx).toEqual({ c1: { id: "c1", n: "landmine romanian deadlift" } });
  });

  it("maps a finished workout to the Hevy shape, warm-ups flagged and undone sets dropped", () => {
    const workout = openGymWorkouts(state).find((w) => w.d === "2026-11-13")!;
    const mapped = fromOpenGym(workout, names, state);
    expect(mapped).toMatchObject({ title: "Full Body C — Split Squat + Croci + Cavi", routine_id: null });
    expect(Date.parse(mapped.end_time) - Date.parse(mapped.start_time)).toBe(workout.end - workout.start);
    expect(mapped.exercises[0]).toMatchObject({ title: "dumbbell single leg split squat", exercise_template_id: "0410" });
    // The raw data keeps the warm-up set that the MCP summary leaves out
    expect(mapped.exercises[0]!.sets[0]!.type).toBe("warmup");
    expect(mapped.exercises[0]!.sets.find((s) => s.type === "normal")).toMatchObject({ weight_kg: 20, reps: 8 });
  });

  it("reads a cardio session preview (no reason, minutes instead of reps)", () => {
    const cardio = previewSchema.parse(tools.preview_session_cardio);
    expect(cardio.exercises[0]).toMatchObject({ name: "stationary bike run v. 3", mode: "cardio" });
    const view = buildOpenGymTraining({ state, plan, preview: cardio, muscles: null, workouts: [], health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    expect(view.next!.exercises[0]).toMatchObject({ label: "1 × 20 min @ 20 km/h", weights: [], openingReps: null, note: null });
  });

  it("numbers the routines like openGym does", () => {
    expect(openGymLetter("1 · Forza — Squat & Panca")).toBe("1");
    expect(openGymLetter("Cyclette — Zona 2")).toBe("C");
  });
});

describe("openGym source", () => {
  it("skips sessions with nothing done and caches exercise names per workout", async () => {
    const calls: string[] = [];
    const api = new OpenGymApi("https://gym.example", "ogt_test", fakeFetch(calls));
    const source = openGymSource(api, "https://gym.example");
    const workouts = await source.workoutsSince("2026-11-01T00:00:00Z");
    // The 10-second cycling session of 17 Nov has no done set
    expect(workouts.map((w) => w.start_time.slice(0, 10))).not.toContain("2026-11-17");
    const named = calls.filter((c) => c === "get_workout").length;
    await source.workoutsSince("2026-11-01T00:00:00Z");
    expect(calls.filter((c) => c === "get_workout").length).toBe(named);
  });

  it("turns HTTP and MCP errors into OpenGymError", async () => {
    const down = new OpenGymApi("https://gym.example", "ogt_test", (async () => new Response("no", { status: 503 })) as unknown as typeof fetch);
    await expect(down.state()).rejects.toBeInstanceOf(OpenGymError);
    const failing = new OpenGymApi("https://gym.example", "ogt_test", (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "nope" } }))) as unknown as typeof fetch);
    await expect(failing.weekPlan()).rejects.toBeInstanceOf(OpenGymError);
  });

  it("keeps at most four requests in flight while naming many workouts", async () => {
    const inner = fakeFetch();
    let running = 0;
    let peak = 0;
    const slow = (async (url: string | URL, init?: RequestInit) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return inner(url, init);
    }) as unknown as typeof fetch;
    const api = new OpenGymApi("https://gym.example", "ogt_test", slow);
    const ids = openGymWorkouts(state).map((w) => w.id);
    expect(ids.length).toBeGreaterThan(4);
    await Promise.all(ids.map((id) => api.exerciseNames(id)));
    expect(peak).toBe(4);
  });

  it("retries a dropped connection once and reports the real cause", async () => {
    const reset = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    let attempts = 0;
    const flaky = (async (url: string | URL, init?: RequestInit) => {
      attempts++;
      if (attempts === 1) throw reset();
      return fakeFetch()(url, init);
    }) as unknown as typeof fetch;
    await expect(new OpenGymApi("https://gym.example", "ogt_test", flaky).weekPlan()).resolves.toBeTruthy();
    expect(attempts).toBe(2);

    let downAttempts = 0;
    const down = (async () => {
      downAttempts++;
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:8080"), { code: "ECONNREFUSED" }) });
    }) as unknown as typeof fetch;
    await expect(new OpenGymApi("https://gym.example", "ogt_test", down).state()).rejects.toThrow(/fetch failed \(ECONNREFUSED connect ECONNREFUSED 10\.0\.0\.5:8080\)/);
    expect(downAttempts).toBe(2);
  });

  it("does not retry a timeout", async () => {
    let attempts = 0;
    const timeout = (async () => {
      attempts++;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(new OpenGymApi("https://gym.example", "ogt_test", timeout).state()).rejects.toThrow(/timed out after 10 s/);
    expect(attempts).toBe(1);
  });
});

describe("buildOpenGymTraining", () => {
  const workouts = openGymWorkouts(state)
    .filter((w) => w.entries.some((e) => e.sets.some((s) => s.done !== false)))
    .map((w) => fromOpenGym(w, names, state));

  it("plans the next session from the week plan, skipping today's when it is done", () => {
    // Today (17 Nov) holds cycling, not done (no done set): it is still the next session
    expect(nextPlannedDate(plan, workouts, "Europe/Rome")).toBe("2026-11-17");
    const doneToday = [{ ...workouts[0]!, routine_id: "rt004", start_time: "2026-11-17T09:00:00Z", end_time: "2026-11-17T09:30:00Z" }, ...workouts];
    expect(nextPlannedDate(plan, doneToday, "Europe/Rome")).toBe("2026-11-18");
  });

  it("shows openGym's opening sets and why they differ from the routine", () => {
    const routineNames = new Map<string, string>(
      Object.values(tools.get_routine as Record<string, { exercises: Array<{ id: string; name: string }> }>).flatMap((r) => r.exercises.map((e) => [e.id, e.name] as [string, string])),
    );
    const view = buildOpenGymTraining({ state, plan, preview, muscles, routineNames, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    expect(view.source).toEqual({ id: "opengym", label: "openGym", openUrl: "https://gym.example" });
    expect(view.next).toMatchObject({ title: "1 · Forza — Squat & Panca", letter: "1", date: "2026-11-18", exerciseCount: 7 });
    // Squat: routine 3 × 6–8 at 53.5 kg, openGym opens at 63.5 kg × 8
    expect(view.next!.exercises[0]).toMatchObject({ title: "barbell full squat", sets: 3, weights: [63.5, 63.5, 63.5], openingReps: 8, repRange: { start: 6, end: 8 } });
    expect(view.next!.exercises[0]!.note).toBe("First time in this routine, so starting from its own target.");
    expect(view.next!.exercises[1]!.note).toBeNull();
    // Week: days done and the routines still planned, out of the four planned weekdays
    expect(view.week.total).toBe(4);
    expect(view.week.days.find((d) => d.date === "2026-11-18")!.planned).toBe("1");
    // Lifts named and attributed to the routine by its short name
    expect(view.lifts.every((l) => !/^\d+$/.test(l.title))).toBe(true);
    expect(view.lifts.flatMap((l) => l.routines)).toContain("1 · Forza");
    // No "try X kg" of Intake's own: openGym's preview decides the next load
    expect(view.lifts.some((l) => l.change.kind === "ready")).toBe(false);
    // Workouts imported from Hevy still get their letter from the title
    expect(view.recent[0]!.letter).toBe("C");
    expect(view.muscles).toEqual({ top: expect.arrayContaining(["chest", "gluteal"]), neglected: ["hip-flexors", "tibialis"] });
  });

  it("details the workout done today, with its sets", () => {
    const view = buildOpenGymTraining({ state, plan, preview, muscles, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-13", openUrl: "https://gym.example" });
    expect(view.todayWorkout).toMatchObject({ title: "Full Body C — Split Squat + Croci + Cavi", start: "16:48", minutes: 41, letter: "C" });
    expect(view.todayWorkout!.exercises.length).toBe(8);
    expect(view.todayWorkout!.exercises[0]!.sets[0]).toEqual({ warmup: true, weightKg: 20, reps: 8, durationSeconds: null });
    // Recap: working sets and volume, compared with the previous Full Body C (6 Nov, matched by title)
    expect(view.todayWorkout).toMatchObject({ sets: 18, previous: { date: "2026-11-06" } });
    expect(view.todayWorkout!.volumeKg).toBeGreaterThan(0);
    expect(view.todayWorkout!.reps).toBeGreaterThan(view.todayWorkout!.sets);
    // Bulgarian split squat at 20 kg beats the earlier 10 kg; cable flyes at 12.5 kg do not beat 15 kg
    expect(view.todayWorkout!.exercises[0]!.record).toBe(true);
    expect(view.todayWorkout!.exercises[1]!.record).toBe(false);
    // Without Apple Health there is no heart rate or kcal
    expect(view.todayWorkout).toMatchObject({ hrMax: null, kcal: null, heartRate: [] });
    // Nothing done on the 17th (the cycling session has no done set)
    expect(buildOpenGymTraining({ state, plan, preview, muscles, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" }).todayWorkout).toBeNull();
  });

  it("adds the session after today's when today's is still to do", () => {
    const cardio = previewSchema.parse(tools.preview_session_cardio);
    expect(plannedAfter(plan, "2026-11-17")).toBe("2026-11-18");
    const view = buildOpenGymTraining({ state, plan, preview: cardio, following: preview, muscles, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    expect(view.next).toMatchObject({ title: "Cyclette — Zona 2", date: "2026-11-17" });
    expect(view.following).toMatchObject({ title: "1 · Forza — Squat & Panca", date: "2026-11-18", exerciseCount: 7 });
    // When the next session is not today, there is nothing to add
    const later = buildOpenGymTraining({ state, plan, preview, following: cardio, muscles, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    expect(later.following).toBeNull();
  });

  /** An Apple Health session of a given family on a date. */
  const session = (family: string, date: string): MergedWorkout =>
    ({ id: `h-${family}`, label: family, family, source: "Fitbit", date, start: `${date}T18:00:00+01:00`, end: `${date}T18:40:00+01:00`, durationMinutes: 40, kcal: 300, distanceKm: null, hrAvg: 130, hrMax: 150, heartRate: [], fromHevy: false, sources: [], heartRateFrom: null, kcalFrom: null, records: [] }) as MergedWorkout;

  it("knows which routines are cardio and which Health family stands for them", () => {
    const byId = (id: string) => state.routines.find((r) => r.id === id)!;
    expect(cardioFamily(byId("rt004"))).toBe("Ciclismo");
    expect(cardioFamily(byId("rt003"))).toBeNull();
    expect([...healthCoveredRoutines(state, [session("Ciclismo", "2026-11-17")], "2026-11-17")]).toEqual(["rt004"]);
    // Football on the same day does not stand for the bike, and yesterday's ride does not count today
    expect(healthCoveredRoutines(state, [session("Calcio", "2026-11-17"), session("Ciclismo", "2026-11-16")], "2026-11-17").size).toBe(0);
  });

  it("counts today's cardio routine as done when Apple Health recorded the ride", () => {
    const health = [session("Ciclismo", "2026-11-17")];
    expect(nextPlannedDate(plan, workouts, "Europe/Rome", healthCoveredRoutines(state, health, "2026-11-17"))).toBe("2026-11-18");
    const view = buildOpenGymTraining({ state, plan, preview, muscles, workouts, health, timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    const today = view.week.days.find((d) => d.date === "2026-11-17")!;
    expect(today).toMatchObject({ letter: "C", planned: null });
    const without = buildOpenGymTraining({ state, plan, preview, muscles, workouts, health: [], timeZone: "Europe/Rome", today: "2026-11-17", openUrl: "https://gym.example" });
    expect(view.week.done).toBe(without.week.done + 1);
  });
});

describe("workout source choice", () => {
  const hevy = hevySource({ workoutsSince: async () => [], routines: async () => [] });
  const openGym = openGymSource(new OpenGymApi("https://gym.example", "ogt_test", fakeFetch()), "https://gym.example");

  it("uses the owner's choice when configured, else the first configured source", () => {
    const sources = new GymSources(openDatabase(":memory:"), { hevy, opengym: openGym });
    expect(sources.available()).toEqual(["hevy", "opengym"]);
    expect(sources.active()!.id).toBe("hevy");
    sources.setPreference("opengym");
    expect(sources.active()!.id).toBe("opengym");
    expect(new GymSources(openDatabase(":memory:"), { opengym: openGym }).active()!.id).toBe("opengym");
  });

  it("switches the source through PUT /api/training/source and serves openGym training", async () => {
    const sources = new GymSources(openDatabase(":memory:"), { hevy, opengym: openGym });
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-17", localTime: "08:00:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), training: { gym: () => sources.active(), sources, api } });
    const headers = { cookie: (await signIn(app)).cookie };
    expect((await app.inject({ method: "GET", url: "/api/training/source", headers })).json()).toEqual({ available: ["hevy", "opengym"], active: "hevy" });
    const switched = await app.inject({ method: "PUT", url: "/api/training/source", headers, payload: { source: "opengym" } });
    expect(switched.json()).toEqual({ available: ["hevy", "opengym"], active: "opengym" });
    expect((await app.inject({ method: "PUT", url: "/api/training/source", headers, payload: { source: "strava" } })).statusCode).toBe(400);
    const view = (await app.inject({ method: "GET", url: "/api/training", headers })).json();
    expect(view).toMatchObject({ configured: true, source: { id: "opengym" }, next: { letter: "1" } });
  });
});
