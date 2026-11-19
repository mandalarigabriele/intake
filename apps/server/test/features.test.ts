import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { FeatureStore, healthWhenOn } from "../src/db/featureStore.js";
import { HealthStore } from "../src/db/healthStore.js";
import type { HealthExport } from "../src/parsers/healthAutoExport.js";
import { blockedBy } from "../src/routes/features.js";
import { ReminderScheduler } from "../src/services/reminderScheduler.js";
import { authOptions, signIn } from "./helpers.js";

const gymApps = { hevy: true, opengym: false };

describe("feature switches", () => {
  it("starts a new installation with only Alimentazione, waiting for the setup", () => {
    const features = new FeatureStore(openDatabase(":memory:"));
    features.adoptExisting({ gymConfigured: true });
    expect(features.get()).toEqual({ setupDone: false, training: false, health: false, reminders: false });
    expect(features.set({ setupDone: true, training: true })).toMatchObject({ setupDone: true, training: true, health: false });
    expect(features.enabled("training")).toBe(true);
  });

  it("keeps what an installation from before the switches already uses", () => {
    const db = openDatabase(":memory:");
    new HealthStore(db).save({ daily: [{ date: "2026-11-19", metric: "steps", value: 4000 }], sleep: [], workouts: [], ignored: { metrics: [], sections: {}, routes: 0 } } as unknown as HealthExport, "sync");
    const features = new FeatureStore(db);
    features.adoptExisting({ gymConfigured: true });
    expect(features.get()).toEqual({ setupDone: true, training: true, health: true, reminders: true });
    // A stored choice is never overwritten
    features.set({ training: false });
    new FeatureStore(db).adoptExisting({ gymConfigured: true });
    expect(new FeatureStore(db).get().training).toBe(false);
  });

  it("maps API URLs to the part that hides them", () => {
    const only = (...on: string[]) => (key: string) => on.includes(key);
    expect(blockedBy("/api/training", only())).toBe("training");
    expect(blockedBy("/api/training/source", only("health"))).toBe("training");
    expect(blockedBy("/api/hevy-sync/run", only("health"))).toBe("training");
    expect(blockedBy("/api/training", only("training"))).toBeNull();
    // The workouts list also carries the Apple Health sessions
    expect(blockedBy("/api/workouts?from=2026-11-19&to=2026-11-19", only("health"))).toBeNull();
    expect(blockedBy("/api/workouts?from=2026-11-19&to=2026-11-19", only())).toBe("training");
    expect(blockedBy("/api/health/ingest", only("training"))).toBe("health");
    expect(blockedBy("/api/health", only())).toBeNull();
    expect(blockedBy("/api/push/subscriptions", only())).toBe("reminders");
    expect(blockedBy("/api/days/2026-11-19", only())).toBeNull();
    expect(blockedBy("/api/trainingx", only())).toBeNull();
  });

  it("serves GET/PUT /api/features and hides the routes of a part that is off", async () => {
    const features = new FeatureStore(openDatabase(":memory:"));
    const health = new HealthStore(openDatabase(":memory:"));
    const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-19", localTime: "11:00:00", utc: "" }) };
    const app = await buildApp({ auth: authOptions(), appleHealth: { store: health, api }, features: { features, gymApps } });
    const { cookie } = await signIn(app);

    expect((await app.inject({ method: "GET", url: "/api/features" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/features", headers: { cookie } })).json()).toEqual({
      setupDone: false,
      training: false,
      health: false,
      reminders: false,
      gymApps,
    });
    const off = await app.inject({ method: "GET", url: "/api/health/status", headers: { cookie } });
    expect(off.statusCode).toBe(404);
    expect(off.json()).toEqual({ error: "feature_disabled", feature: "health" });
    // The app's own liveness check is not part of Salute
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);

    const put = await app.inject({ method: "PUT", url: "/api/features", headers: { cookie }, payload: { setupDone: true, health: true } });
    expect(put.json()).toMatchObject({ setupDone: true, health: true, training: false });
    expect((await app.inject({ method: "GET", url: "/api/health/status", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/features", headers: { cookie }, payload: { nutrition: false } })).statusCode).toBe(400);
  });

  it("gives the other screens no Apple Health data while Salute is off", () => {
    const db = openDatabase(":memory:");
    const store = new HealthStore(db);
    store.save({ daily: [{ date: "2026-11-19", metric: "steps", value: 4000 }], sleep: [], workouts: [], ignored: { metrics: [], sections: {}, routes: 0 } } as unknown as HealthExport, "sync");
    const features = new FeatureStore(db);
    const health = healthWhenOn(store, features);
    expect(health.daily("2026-11-19", "2026-11-19")).toEqual([]);
    features.set({ health: true });
    expect(health.daily("2026-11-19", "2026-11-19")).toHaveLength(1);
  });

  it("skips the reminder checks while Promemoria is off", async () => {
    let ticks = 0;
    let enabled = false;
    const scheduler = new ReminderScheduler({ store: {} as never, plans: {} as never, api: {} as never, sender: {} as never, log: { warn() {}, info() {} }, enabled: () => enabled });
    scheduler.tick = async () => ++ticks;
    scheduler.start(5);
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(0);
    enabled = true;
    await new Promise((r) => setTimeout(r, 30));
    scheduler.stop();
    expect(ticks).toBeGreaterThan(0);
  });
});
