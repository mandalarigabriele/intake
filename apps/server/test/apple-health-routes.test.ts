import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { HealthStore } from "../src/db/healthStore.js";
import { irregularity } from "../src/services/healthImport.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const exportJson = JSON.parse(fixture("health-auto-export.json"));

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
};

describe("irregularity", () => {
  it("finds the day active energy stopped arriving regularly (real pattern: 3 days of 19 after 25 Oct)", () => {
    const reference = days("2026-10-01", "2026-11-13");
    const active = [...days("2026-10-01", "2026-10-25"), "2026-11-01", "2026-11-08", "2026-11-10"];
    expect(irregularity(active, reference)).toEqual({ since: "2026-10-25", presentDays: 3, totalDays: 19 });
  });

  it("is null for regular data and for a missing last day or two", () => {
    const reference = days("2026-10-01", "2026-11-13");
    expect(irregularity(reference, reference)).toBeNull();
    expect(irregularity(days("2026-10-01", "2026-11-11"), reference)).toBeNull();
  });

  it("flags data that was never regular, without a date", () => {
    const reference = days("2026-10-01", "2026-11-13");
    expect(irregularity(["2026-10-24", "2026-10-26"], reference)).toEqual({ since: null, presentDays: 0, totalDays: 14 });
  });
});

describe("Apple Health routes", () => {
  async function setup() {
    const store = new HealthStore(openDatabase(":memory:"));
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-10-31", localTime: "11:42:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), appleHealth: { store, api } });
    const { cookie } = await signIn(app);
    return { app, store, headers: { cookie } };
  }

  it("previews an import without writing, then imports it", async () => {
    const { app, store, headers } = await setup();
    const preview = await app.inject({ method: "POST", url: "/api/health/import", headers, payload: exportJson });
    expect(preview.statusCode).toBe(200);
    const body = preview.json().preview;
    expect(body).toMatchObject({ firstDate: "2026-10-23", lastDate: "2026-10-30", days: 8, newDays: 8, updatedDays: 0 });
    expect(body.metrics).toEqual([
      { metric: "steps", days: 8, irregular: null },
      { metric: "distanceKm", days: 8, irregular: null },
      { metric: "sleep", days: 7, irregular: null },
      { metric: "restingHr", days: 8, irregular: null },
      { metric: "activeKcal", days: 3, irregular: { since: "2026-10-25" } },
      { metric: "restingKcal", days: 2, irregular: { since: null } },
    ]);
    expect(body.workouts).toMatchObject({ found: 17, discarded: 5, sessions: 12 });
    expect(body.workouts.byFamily).toEqual([
      { family: "Calcio", count: 3 },
      { family: "Ciclismo", count: 3 },
      { family: "Forza", count: 3 },
      { family: "Racchetta", count: 2 },
      { family: "Camminata", count: 1 },
    ]);
    expect(body.workouts.duplicates).toEqual([
      {
        date: "2026-10-24",
        label: "Forza",
        start: "11:36",
        end: "12:57",
        records: [
          { source: "Hevy", label: "Forza", start: "11:36", end: "12:55" },
          { source: "Fitbit", label: "Forza", start: "11:43", end: "12:57" },
        ],
        kept: "Hevy",
        heartRateFrom: "Fitbit",
        joined: false,
        renamed: false,
        discarded: 1,
      },
      expect.objectContaining({ date: "2026-10-25", label: "Cyclette", kept: "MERACH", heartRateFrom: "Fitbit", renamed: true, discarded: 1 }),
      expect.objectContaining({ date: "2026-10-26", kept: "Fitbit", heartRateFrom: null, joined: false, discarded: 1 }),
      expect.objectContaining({ date: "2026-10-29", start: "13:07", end: "14:06", kept: "Fitbit", joined: true, discarded: 2 }),
    ]);
    expect(body.ignored).toEqual(["nutrition", "weight", "private", "detail"]);
    expect(store.imports()).toEqual([]);

    const committed = await app.inject({ method: "POST", url: "/api/health/import?commit=true", headers, payload: exportJson });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().preview).toMatchObject({ newDays: 8, updatedDays: 0 });
    expect(store.imports()).toHaveLength(1);

    // Same file again: everything is an update
    const again = await app.inject({ method: "POST", url: "/api/health/import", headers, payload: exportJson });
    expect(again.json().preview).toMatchObject({ days: 8, newDays: 0, updatedDays: 8 });
  });

  it("reports the data status with coverage, sources and the active energy warning", async () => {
    const { app, headers } = await setup();
    await app.inject({ method: "POST", url: "/api/health/import?commit=true", headers, payload: exportJson });
    const response = await app.inject({ method: "GET", url: "/api/health/status", headers });
    expect(response.statusCode).toBe(200);
    const status = response.json();
    expect(status).toMatchObject({
      today: "2026-10-31",
      lastImport: { kind: "file" },
      firstDate: "2026-10-23",
      lastDate: "2026-10-30",
      days: 8,
      workouts: 12,
      sources: ["Fitbit", "MERACH", "Hevy", "Bevel"],
      activeEnergyWarning: { since: "2026-10-25", presentDays: 0, totalDays: 5 },
      settings: { stepGoal: 8000 },
    });
    // 23 Oct – 31 Oct (today, no data yet)
    expect(status.coverage.from).toBe("2026-10-23");
    expect(status.coverage.to).toBe("2026-10-31");
    expect(status.coverage.rows).toEqual([
      { metric: "steps", cells: "ppppppppm" },
      { metric: "sleep", cells: "mpppppppm" },
      { metric: "restingHr", cells: "ppppppppm" },
      { metric: "activeKcal", cells: "pppmmmmmm" },
      { metric: "workouts", cells: "mpppppppm" },
    ]);
  });

  it("returns one day for the Today card: values, 7-day series and averages", async () => {
    const { app, headers } = await setup();
    const before = (await app.inject({ method: "GET", url: "/api/health/days/today", headers })).json();
    expect(before).toMatchObject({ date: "2026-10-31", connected: false, steps: null, sleep: null });

    await app.inject({ method: "POST", url: "/api/health/import?commit=true", headers, payload: exportJson });
    const day = (await app.inject({ method: "GET", url: "/api/health/days/2026-10-30", headers })).json();
    expect(day).toMatchObject({
      date: "2026-10-30",
      today: "2026-10-31",
      connected: true,
      steps: 4096,
      distanceKm: 3.067,
      stepsAverage: 6768,
      sleep: { bedtime: "23:33", wake: "07:31", asleepMinutes: 429, deepMinutes: 76, remMinutes: 73, coreMinutes: 280, awakeMinutes: 49 },
      restingHr: 64,
      restingHrLastWeek: 61,
      source: "Fitbit",
      lastDataDate: "2026-10-30",
    });
    expect(day.stepsSeries.map((p: { value: number | null }) => p.value)).toEqual([5913, 4719, 4128, 13674, 6056, 6036, 4096]);
    expect(day.sleepSeries).toHaveLength(7);
    expect(day.restingHrSeries).toHaveLength(8);

    // A day without Health data
    const empty = (await app.inject({ method: "GET", url: "/api/health/days/2026-10-31", headers })).json();
    expect(empty).toMatchObject({ connected: true, steps: null, sleep: null, restingHr: null, stepsAverage: 6375 });
    expect((await app.inject({ method: "GET", url: "/api/health/days/31-10-2026", headers })).statusCode).toBe(400);
  });

  it("returns an empty status before any import", async () => {
    const { app, headers } = await setup();
    const status = (await app.inject({ method: "GET", url: "/api/health/status", headers })).json();
    expect(status).toMatchObject({ lastImport: null, days: 0, workouts: 0, coverage: null, sources: [], activeEnergyWarning: null });
  });

  it("rejects files that are not exports, exports without data and invalid settings", async () => {
    const { app, headers } = await setup();
    const wrong = await app.inject({ method: "POST", url: "/api/health/import", headers, payload: { meals: [] } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ error: "not_health_export" });
    const empty = await app.inject({ method: "POST", url: "/api/health/import", headers, payload: { data: { metrics: [{ name: "protein", units: "g", data: [] }], workouts: [] } } });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toEqual({ error: "no_data" });
    expect((await app.inject({ method: "PUT", url: "/api/health/settings", headers, payload: { stepGoal: 100 } })).statusCode).toBe(400);
  });

  it("saves the step goal", async () => {
    const { app, store, headers } = await setup();
    const response = await app.inject({ method: "PUT", url: "/api/health/settings", headers, payload: { stepGoal: 9500 } });
    expect(response.json()).toEqual({ stepGoal: 9500 });
    expect(store.settings()).toEqual({ stepGoal: 9500 });
  });

  it("requires sign-in", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/api/health/status" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/health/import", payload: exportJson })).statusCode).toBe(401);
  });
});
