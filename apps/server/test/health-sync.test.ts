import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { HealthStore } from "../src/db/healthStore.js";
import { SecretBox } from "../src/db/secretBox.js";
import { SecretStore } from "../src/db/secretStore.js";
import { HealthIngestToken } from "../src/services/healthSync.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const exportJson = JSON.parse(fixture("health-auto-export.json"));

async function setup() {
  const db = openDatabase(":memory:");
  const store = new HealthStore(db);
  const token = new HealthIngestToken(new SecretStore(db, new SecretBox("test-secret-key-test-secret-key")));
  const api = { clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-10-31", localTime: "11:42:00", utc: "" }) };
  const app = await buildApp({
    auth: authOptions(),
    appleHealth: { store, api, sync: { token, endpoint: "https://intake.example/api/health/ingest" } },
    healthIngest: { store, token },
  });
  const { cookie } = await signIn(app);
  return { app, store, token, headers: { cookie } };
}

describe("Health Auto Export automatic upload", () => {
  it("is off until the owner creates a token, then accepts uploads with it", async () => {
    const { app, store, headers } = await setup();
    const off = (await app.inject({ method: "GET", url: "/api/health/sync", headers })).json();
    expect(off).toEqual({ enabled: false, token: null, endpoint: "https://intake.example/api/health/ingest", lastReceivedAt: null });
    // Disabled: every upload is refused
    expect((await app.inject({ method: "POST", url: "/api/health/ingest", payload: exportJson, headers: { authorization: "Bearer x" } })).statusCode).toBe(401);

    const on = (await app.inject({ method: "POST", url: "/api/health/sync/token", headers })).json();
    expect(on.enabled).toBe(true);
    expect(on.token).toMatch(/^[\w-]{43}$/);

    // No Google session needed, the token is enough (with or without "Bearer")
    const upload = await app.inject({ method: "POST", url: "/api/health/ingest", payload: exportJson, headers: { authorization: `Bearer ${on.token}` } });
    expect(upload.statusCode).toBe(200);
    expect(upload.json()).toMatchObject({ ok: true, saved: true });
    expect(store.imports(1)[0]!.kind).toBe("sync");
    const again = await app.inject({ method: "POST", url: "/api/health/ingest", payload: exportJson, headers: { authorization: on.token } });
    expect(again.json().counts.newDays).toBe(0);

    const status = (await app.inject({ method: "GET", url: "/api/health/sync", headers })).json();
    expect(status.lastReceivedAt).not.toBeNull();
  });

  it("refuses a wrong or old token, and every upload once turned off", async () => {
    const { app, headers } = await setup();
    const first = (await app.inject({ method: "POST", url: "/api/health/sync/token", headers })).json().token as string;
    const second = (await app.inject({ method: "POST", url: "/api/health/sync/token", headers })).json().token as string;
    expect(second).not.toBe(first);
    const send = (authorization?: string) =>
      app.inject({ method: "POST", url: "/api/health/ingest", payload: exportJson, headers: authorization ? { authorization } : {} });
    expect((await send()).statusCode).toBe(401);
    expect((await send(`Bearer ${first}`)).statusCode).toBe(401);
    expect((await send(`Bearer ${second.slice(0, -1)}x`)).statusCode).toBe(401);
    expect((await send(`Bearer ${second}`)).statusCode).toBe(200);

    const off = (await app.inject({ method: "DELETE", url: "/api/health/sync", headers })).json();
    expect(off).toMatchObject({ enabled: false, token: null });
    expect((await send(`Bearer ${second}`)).statusCode).toBe(401);
  });

  it("answers 400 to bodies that are not exports and 200 to uploads with nothing to keep", async () => {
    const { app, token } = await setup();
    const value = token.rotate();
    const authorization = `Bearer ${value}`;
    expect((await app.inject({ method: "POST", url: "/api/health/ingest", payload: { meals: [] }, headers: { authorization } })).statusCode).toBe(400);
    const empty = await app.inject({ method: "POST", url: "/api/health/ingest", payload: { data: { metrics: [{ name: "protein", units: "g", data: [] }], workouts: [] } }, headers: { authorization } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ ok: true, saved: false });
  });

  it("keeps the sync settings behind Google sign-in", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/api/health/sync" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/health/sync/token" })).statusCode).toBe(401);
  });
});
