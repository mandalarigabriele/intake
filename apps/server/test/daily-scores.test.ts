import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { HealthStore } from "../src/db/healthStore.js";
import type { HealthDailyValue, HealthExport, HealthSleep } from "../src/parsers/healthAutoExport.js";
import { dailyScores, effortPercent, regularityPenalty, sleepNeed, trimp } from "../src/services/dailyScores.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function night(date: string, asleepMinutes: number): HealthSleep {
  return { date, start: `${addDays(date, -1)}T23:30:00+01:00`, end: `${date}T07:30:00+01:00`, asleepMinutes, deepMinutes: 80, remMinutes: 90, coreMinutes: asleepMinutes - 170, awakeMinutes: 10, inBedMinutes: asleepMinutes + 10, source: "Google Health" };
}

/** 20 days before 2026-11-20 with resting HR 60, respiratory rate 14 and, optionally, HRV 50 ms. */
function store(options: { hrv?: boolean; today: Partial<Record<"restingHr" | "hrvMs" | "respiratoryRate" | "steps", number>>; sleep?: number }) {
  const s = new HealthStore(openDatabase(":memory:"));
  const daily: HealthDailyValue[] = [];
  for (let i = 1; i <= 20; i++) {
    const date = addDays("2026-11-20", -i);
    daily.push({ date, metric: "restingHr", value: 60 }, { date, metric: "respiratoryRate", value: 14 }, { date, metric: "steps", value: 6000 });
    if (options.hrv) daily.push({ date, metric: "hrvMs", value: 50 });
  }
  for (const [metric, value] of Object.entries(options.today)) daily.push({ date: "2026-11-20", metric: metric as HealthDailyValue["metric"], value });
  const data: HealthExport = {
    daily,
    sleep: options.sleep ? [night("2026-11-20", options.sleep)] : [],
    workouts: [],
    ignored: { metrics: [], sections: {}, routes: 0 },
  } as unknown as HealthExport;
  s.save(data, "sync");
  return s;
}

describe("daily score formulas", () => {
  it("grows Sforzo with the training load and saturates towards 100%", () => {
    expect(effortPercent(0)).toBe(0);
    expect(effortPercent(60)).toBe(63);
    expect(effortPercent(300)).toBe(99);
    // 50 minutes at half of the heart-rate reserve
    expect(Math.round(trimp(50, 0.5))).toBe(42);
    expect(trimp(30, 0)).toBe(0);
  });

  it("takes up to 10 points off for falling asleep far from the usual time", () => {
    expect(regularityPenalty(-30, [-30, -20, -40])).toBe(0);
    expect(regularityPenalty(15, [-30, -30, -30])).toBe(0);
    expect(regularityPenalty(16, [-30, -30, -30])).toBe(1);
    expect(regularityPenalty(60, [-30, -30, -30])).toBe(5);
    expect(regularityPenalty(240, [-30, -30, -30])).toBe(10);
    expect(regularityPenalty(240, [-30, -30])).toBe(0);
  });

  it("asks for up to 30 more minutes of sleep after a hard day", () => {
    expect(sleepNeed(null)).toBe(480);
    expect(sleepNeed(40)).toBe(480);
    expect(sleepNeed(75)).toBe(495);
    expect(sleepNeed(100)).toBe(510);
  });
});

describe("dailyScores", () => {
  it("uses HRV first when a watch writes it", () => {
    const scores = dailyScores(store({ hrv: true, today: { hrvMs: 55, restingHr: 60, respiratoryRate: 14 }, sleep: 480 }), "2026-11-20", "2026-11-20");
    expect(scores.recovery!.usesHrv).toBe(true);
    expect(scores.recovery!.parts.map((p) => [p.key, p.score, p.weight])).toEqual([
      ["hrv", 85, 0.5],
      ["restingHr", 65, 0.2],
      ["sleep", 100, 0.3],
    ]);
    expect(scores.recovery!.percent).toBe(86);
    expect(scores.sleep).toEqual({ percent: 100, asleepMinutes: 480, needMinutes: 480, bedtime: "23:30", wake: "07:30", regularityPenalty: 0 });
  });

  it("without HRV uses resting HR, respiratory rate and sleep", () => {
    const scores = dailyScores(store({ today: { restingHr: 57, respiratoryRate: 14.7 }, sleep: 360 }), "2026-11-20", "2026-11-20");
    expect(scores.recovery!.usesHrv).toBe(false);
    // Resting HR 5% under the baseline is good, breathing 5% faster is not
    expect(scores.recovery!.parts.map((p) => [p.key, p.score])).toEqual([
      ["restingHr", 80],
      ["respiratoryRate", 50],
      ["sleep", 75],
    ]);
    expect(scores.recovery!.percent).toBe(72);
  });

  it("is calibrating without enough history, and Sforzo comes from the steps", () => {
    const s = new HealthStore(openDatabase(":memory:"));
    s.save({ daily: [{ date: "2026-11-20", metric: "restingHr", value: 58 }, { date: "2026-11-20", metric: "steps", value: 10000 }], sleep: [night("2026-11-20", 420)], workouts: [], ignored: { metrics: [], sections: {}, routes: 0 } } as unknown as HealthExport, "sync");
    const scores = dailyScores(s, "2026-11-20", "2026-11-20");
    expect(scores.recovery).toMatchObject({ percent: null, usesHrv: false });
    expect(scores.effort).toMatchObject({ percent: 22, movement: { from: "steps", value: 10000, load: 15 } });
    expect(scores.sleep!.percent).toBe(88);
  });

  it("is served by GET /api/health/scores/:date and hidden before any import", async () => {
    const health = new HealthStore(openDatabase(":memory:"));
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-10-31", localTime: "11:42:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), appleHealth: { store: health, api } });
    const { cookie } = await signIn(app);
    const before = (await app.inject({ method: "GET", url: "/api/health/scores/today", headers: { cookie } })).json();
    expect(before).toMatchObject({ date: "2026-10-31", connected: false, effort: null, recovery: null, sleep: null });

    await app.inject({ method: "POST", url: "/api/health/import?commit=true", headers: { cookie }, payload: JSON.parse(fixture("health-auto-export.json")) });
    const day = (await app.inject({ method: "GET", url: "/api/health/scores/2026-10-30", headers: { cookie } })).json();
    expect(day.connected).toBe(true);
    expect(day.effort.percent).toBeGreaterThan(0);
    expect(day.sleep).toMatchObject({ asleepMinutes: 429 });
    expect((await app.inject({ method: "GET", url: "/api/health/scores/30-10-2026", headers: { cookie } })).statusCode).toBe(400);
  });
});
