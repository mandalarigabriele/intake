import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { HevyApi, HevyError } from "../src/hevy/hevyApi.js";
import { hevyWorkoutPageSchema, localDateTime, toWorkout } from "../src/parsers/hevy.js";
import type { HealthWorkout } from "../src/parsers/healthAutoExport.js";
import { combineWorkouts, heartRateCurve } from "../src/services/dayWorkouts.js";
import { mergeWorkouts } from "../src/services/healthWorkouts.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const page = hevyWorkoutPageSchema.parse(JSON.parse(fixture("hevy-workouts.json")));

describe("Hevy parser (real GET /v1/workouts response)", () => {
  it("reads a page of workouts, newest first", () => {
    expect(page.workouts).toHaveLength(3);
    expect(page.workouts[0]!.title).toBe("Full Body C — Split Squat + Croci + Cavi");
  });

  it("converts a workout to the profile timezone and summarizes its exercises", () => {
    const workout = toWorkout(page.workouts[0]!, "Europe/Rome");
    expect(workout).toMatchObject({ date: "2026-11-06", start: "08:38", end: "09:35", durationMinutes: 57, sets: 17, volumeKg: 5738 });
    expect(workout.exercises).toHaveLength(7);
    // Warm-up sets do not count; the heaviest working set is kept
    expect(workout.exercises[0]).toEqual({ title: "Affondo Bulgaro (Manubrio)", workingSets: 3, best: { weightKg: 10, reps: 8 }, durationSeconds: 0 });
    expect(workout.exercises[4]).toMatchObject({ title: "Lat Pulldown (Cavo)", workingSets: 2, best: { weightKg: 75, reps: 10 } });
  });

  it("computes local dates across midnight", () => {
    expect(localDateTime("2026-11-05T23:30:00Z", "Europe/Rome")).toEqual({ date: "2026-11-06", time: "00:30" });
  });
});

describe("HevyApi", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("walks back page by page until the workouts are older than the start, and caches pages", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const n = Number(new URL(String(url)).searchParams.get("page"));
      return json({ ...page, page: n, page_count: 5 });
    });
    const api = new HevyApi("key", fetchImpl as typeof fetch, () => 0);
    // The fixture's oldest workout (2026-11-04) is older than this start: one page is enough
    const workouts = await api.workoutsSince("2026-11-05T00:00:00Z");
    expect(workouts.map((w) => w.start_time.slice(0, 10))).toEqual(["2026-11-06", "2026-11-05"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api.hevyapp.com/v1/workouts?page=1&pageSize=10");
    await api.workoutsSince("2026-11-05T00:00:00Z");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Further back: the next pages are read too
    await api.workoutsSince("2026-10-01T00:00:00Z");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("sends the API key and reports errors as HevyError", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "Unauthorized" }, 401));
    const api = new HevyApi("secret-key", fetchImpl as typeof fetch);
    await expect(api.workoutsSince("2026-11-01T00:00:00Z")).rejects.toBeInstanceOf(HevyError);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "api-key": "secret-key" });
  });
});

describe("workout routes", () => {
  async function setup(hevy: { workoutsSince: (since: string) => Promise<typeof page.workouts> } | null) {
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-06", localTime: "12:00:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), workouts: { hevy, api } });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("returns the workouts of a local date range, oldest first", async () => {
    const workoutsSince = vi.fn(async () => page.workouts);
    const { app, headers } = await setup({ workoutsSince });
    const response = await app.inject({ method: "GET", url: "/api/workouts?from=2026-11-05&to=2026-11-06", headers });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.configured).toBe(true);
    expect(body.workouts.map((w: { date: string; start: string }) => `${w.date} ${w.start}`)).toEqual(["2026-11-05 16:29", "2026-11-06 08:38"]);
    expect(workoutsSince).toHaveBeenCalledWith("2026-11-04T00:00:00.000Z");
  });

  it("says when Hevy is not configured, validates the range and maps Hevy failures to 502", async () => {
    const off = await setup(null);
    expect((await off.app.inject({ method: "GET", url: "/api/workouts?from=2026-11-01&to=2026-11-07", headers: off.headers })).json()).toEqual({ configured: false, workouts: [] });
    expect((await off.app.inject({ method: "GET", url: "/api/workouts?from=2026-11-07&to=2026-11-01", headers: off.headers })).statusCode).toBe(400);
    expect((await off.app.inject({ method: "GET", url: "/api/workouts?from=2026-01-01&to=2026-11-01", headers: off.headers })).statusCode).toBe(400);

    const failing = await setup({ workoutsSince: async () => Promise.reject(new HevyError("down")) });
    const response = await failing.app.inject({ method: "GET", url: "/api/workouts?from=2026-11-01&to=2026-11-07", headers: failing.headers });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("hevy_unavailable");
  });

  it("requires sign-in", async () => {
    const { app } = await setup(null);
    expect((await app.inject({ method: "GET", url: "/api/workouts?from=2026-11-01&to=2026-11-07" })).statusCode).toBe(401);
  });
});

describe("Hevy and Apple Health workouts together", () => {
  // Health Auto Export heart-rate points carry the local time of day
  const hr = (start: string, bpms: number[]) => bpms.map((bpm, i) => ({ time: `${start.slice(0, 3)}${String(Number(start.slice(3)) + i).padStart(2, "0")}`, bpm }));
  const record = (over: Partial<HealthWorkout>): HealthWorkout => ({
    id: "r",
    source: "Google Health",
    name: "Allenamento di Forza Tradizionale",
    date: "2026-11-06",
    start: "2026-11-06T08:40:00+01:00",
    end: "2026-11-06T09:30:00+01:00",
    kcal: null,
    distanceKm: null,
    hrAvg: null,
    hrMax: null,
    heartRate: [],
    ...over,
  });
  // Hevy: 06/11 08:38–09:35 (Rome); Fitbit strength 08:40–09:30 with heart rate; MERACH cycling in the afternoon
  const health = [
    record({ id: "fitbit-strength", kcal: 210, hrAvg: 112, hrMax: 150, heartRate: hr("08:40", [95, 110, 130]) }),
    record({ id: "bevel-strength", source: "Bevel", kcal: 180, hrAvg: 108, hrMax: 140 }),
    record({ id: "merach-bike", source: "MERACH", name: "Interno Ciclismo", start: "2026-11-06T15:00:00+01:00", end: "2026-11-06T15:30:00+01:00", kcal: 250, distanceKm: 11.7, hrAvg: 135, hrMax: 145 }),
  ];

  it("enriches the Hevy workout with heart rate and kcal and keeps the other sessions", () => {
    const workouts = combineWorkouts(page.workouts.slice(0, 1), mergeWorkouts(health), "Europe/Rome");
    expect(workouts.map((w) => `${w.origin} ${w.start} ${w.title}`)).toEqual([
      "hevy 08:38 Full Body C — Split Squat + Croci + Cavi",
      "health 15:00 Cyclette",
    ]);
    const [strength, bike] = workouts;
    expect(strength).toMatchObject({ source: "Hevy", type: "Forza", family: "Forza", kcal: 210, hrAvg: 112, hrMax: 150, heartRateFrom: "Fitbit", kcalFrom: "Fitbit" });
    expect(strength!.exercises.length).toBeGreaterThan(0);
    expect(strength!.sources).toEqual([
      { label: "Hevy", used: true },
      { label: "Fitbit", used: true },
      { label: "Bevel", used: false },
    ]);
    // Minutes are counted from the Hevy start (08:38 in Rome), not from the Fitbit one
    expect(strength!.heartRate).toEqual([
      { minute: 2, bpm: 95 },
      { minute: 3, bpm: 110 },
      { minute: 4, bpm: 130 },
    ]);
    expect(bike).toMatchObject({ id: "health-merach-bike", source: "MERACH", type: "Cyclette", family: "Ciclismo", distanceKm: 11.7, kcal: 250, sets: 0, exercises: [] });
  });

  it("counts heart-rate minutes across midnight and drops points outside the session", () => {
    expect(heartRateCurve([{ time: "23:58", bpm: 90 }, { time: "00:01", bpm: 100 }, { time: "02:00", bpm: 80 }], "23:58", 30)).toEqual([
      { minute: 0, bpm: 90 },
      { minute: 3, bpm: 100 },
    ]);
  });

  it("does not attach a non-strength session or one that barely overlaps", () => {
    const short = record({ id: "late", start: "2026-11-06T09:25:00+01:00", end: "2026-11-06T10:30:00+01:00", hrAvg: 100 });
    const walk = record({ id: "walk", name: "Camminata", hrAvg: 90 });
    const workouts = combineWorkouts(page.workouts.slice(0, 1), mergeWorkouts([short, walk]), "Europe/Rome");
    expect(workouts.map((w) => `${w.origin} ${w.title}`)).toEqual(["hevy Full Body C — Split Squat + Croci + Cavi", "health Camminata", "health Forza"]);
    expect(workouts[0]!.hrAvg).toBeNull();
  });

  it("lists Apple Health workouts without Hevy and when Hevy is down", async () => {
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-06", localTime: "12:00:00", utc: "" }) };
    const store = { workouts: (from: string, to: string) => health.filter((w) => w.date >= from && w.date <= to) };
    const off = await buildApp({ auth: authOptions(), workouts: { hevy: null, health: store, api } });
    const offHeaders = { cookie: (await signIn(off)).cookie };
    const body = (await off.inject({ method: "GET", url: "/api/workouts?from=2026-11-06&to=2026-11-06", headers: offHeaders })).json();
    expect(body.configured).toBe(false);
    expect(body.workouts.map((w: { title: string; source: string }) => `${w.title} ${w.source}`)).toEqual(["Forza Fitbit", "Cyclette MERACH"]);

    const down = await buildApp({ auth: authOptions(), workouts: { hevy: { workoutsSince: async () => Promise.reject(new HevyError("down")) }, health: store, api } });
    const downHeaders = { cookie: (await signIn(down)).cookie };
    const response = await down.inject({ method: "GET", url: "/api/workouts?from=2026-11-06&to=2026-11-06", headers: downHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ configured: true, hevyUnavailable: true });
    expect(response.json().workouts).toHaveLength(2);
  });
});
