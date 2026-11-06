import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { HevyApi, HevyError } from "../src/hevy/hevyApi.js";
import { hevyWorkoutPageSchema, localDateTime, toWorkout } from "../src/parsers/hevy.js";
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
