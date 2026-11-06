import { readFileSync } from "node:fs";
import { mealPlanSchema, type Meal, type PlannedEntry } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { PlanStore } from "../src/db/planStore.js";
import { DEFAULT_REMINDER_SETTINGS, ReminderStore } from "../src/db/reminderStore.js";
import { ReminderScheduler, type PushSender } from "../src/services/reminderScheduler.js";
import { buildNotification, dueSlots } from "../src/services/reminders.js";
import { authOptions, signIn } from "./helpers.js";

const examplePlan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));
const all = DEFAULT_REMINDER_SETTINGS;
const planned = [
  { planId: 1, index: 0, time: "08:00" },
  { planId: 1, index: 2, time: "13:00" },
];

const entry = (overrides: Partial<PlannedEntry> = {}): PlannedEntry => ({
  planId: 1,
  index: 2,
  title: "Pranzo",
  time: "13:00",
  type: "lunch",
  foods: "Insalata di farro",
  lines: [],
  status: "planned",
  macros: { kcal: 642, protein: 40, carbs: 70, fat: 20, fiber: 10 },
  ...overrides,
});

const totals = (kcal: number, waterMl: number) => ({ kcal, protein: 80, carbs: 0, fat: 0, fiber: 0, waterMl });
const goals = { kcal: 2200, protein: 135, carbs: null, fat: null, fiber: null, waterMl: 2500 };

describe("dueSlots", () => {
  it("fires a meal reminder in the 10 minutes after the planned time, and the to-log one 45 minutes later", () => {
    expect(dueSlots("2026-11-06", "12:59", planned, all)).toEqual([]);
    expect(dueSlots("2026-11-06", "13:00", planned, all).map((s) => s.key)).toEqual(["meal:2026-11-06:1:2"]);
    expect(dueSlots("2026-11-06", "13:09", planned, all).map((s) => s.kind)).toEqual(["meal"]);
    expect(dueSlots("2026-11-06", "13:10", planned, all)).toEqual([]);
    expect(dueSlots("2026-11-06", "13:47", planned, all).map((s) => s.key)).toEqual(["todo:2026-11-06:1:2"]);
  });

  it("schedules water at 16:00 and 20:00 and the summary at 21:30, each only when enabled", () => {
    expect(dueSlots("2026-11-06", "16:03", [], all).map((s) => s.key)).toEqual(["water:2026-11-06:16:00"]);
    expect(dueSlots("2026-11-06", "21:31", [], all).map((s) => s.key)).toEqual(["summary:2026-11-06"]);
    const none = { meal: false, todo: false, water: false, summary: false };
    expect(dueSlots("2026-11-06", "13:00", planned, none)).toEqual([]);
    expect(dueSlots("2026-11-06", "16:00", [], none)).toEqual([]);
  });
});

describe("buildNotification", () => {
  const context = { now: "13:00", entries: [entry()], totals: null, goals: null };

  it("reminds an open planned meal with its foods and kcal", () => {
    expect(buildNotification({ key: "k", kind: "meal", planId: 1, index: 2 }, context)).toEqual({
      title: "Pranzo · 13:00",
      body: "Insalata di farro · ~642 kcal",
      url: "/",
      tag: "meal-2",
    });
    expect(buildNotification({ key: "k", kind: "todo", planId: 1, index: 2 }, { ...context, entries: [entry({ status: "todo" })] })?.title).toBe(
      "Pranzo delle 13:00: l'hai registrato?",
    );
  });

  it("stays quiet for a meal already logged (no entry), skipped or free", () => {
    const slot = { key: "k", kind: "meal" as const, planId: 1, index: 2 };
    expect(buildNotification(slot, { ...context, entries: [] })).toBeNull();
    expect(buildNotification(slot, { ...context, entries: [entry({ status: "skipped" })] })).toBeNull();
    expect(buildNotification(slot, { ...context, entries: [entry({ status: "free", macros: null })] })).toBeNull();
  });

  it("reminds water only when behind the share of the goal expected by now", () => {
    const slot = { key: "k", kind: "water" as const };
    // At 16:00 about 62% of 2,5 L (1,54 L) is expected
    expect(buildNotification(slot, { now: "16:00", entries: [], totals: totals(0, 750), goals })).toEqual({
      title: "Acqua: 0,75 su 2,5 L",
      body: "Un bicchiere adesso? Ne mancano 1,75 L.",
      url: "/",
      tag: "water",
    });
    expect(buildNotification(slot, { now: "16:00", entries: [], totals: totals(0, 1400), goals })).toBeNull();
    expect(buildNotification(slot, { now: "16:00", entries: [], totals: totals(0, 0), goals: { ...goals, waterMl: null } })).toBeNull();
  });

  it("summarizes the day against the goals, only when something was logged", () => {
    const slot = { key: "k", kind: "summary" as const };
    expect(buildNotification(slot, { now: "21:30", entries: [], totals: totals(1950, 0), goals })?.body).toBe("1.950 kcal su 2.200 · proteine 80 su 135 g");
    expect(buildNotification(slot, { now: "21:30", entries: [], totals: totals(0, 0), goals })).toBeNull();
  });
});

describe("ReminderScheduler", () => {
  function setup(now: string, meals: Meal[] = []) {
    const db = openDatabase(":memory:");
    const store = new ReminderStore(db);
    const plans = new PlanStore(db);
    plans.add({ ...examplePlan, validFrom: "2026-11-02" });
    const sender: PushSender & { send: ReturnType<typeof vi.fn> } = { send: vi.fn(async () => "ok" as const) };
    const api = {
      clock: vi.fn(async () => ({ timezone: "Europe/Rome", localDate: "2026-11-05", localTime: `${now}:00`, utc: "" })),
      mealsByDate: vi.fn(async () => ({ timezone: null, meals })),
      goalProgress: vi.fn(async () => ({ date: "2026-11-05", goals, totals: totals(1200, 500) })),
    };
    const log = { warn: vi.fn(), info: vi.fn() };
    const scheduler = new ReminderScheduler({ store, plans, api, sender, log });
    return { store, sender, api, scheduler };
  }
  const device = { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } };

  it("does nothing, not even reading the clock, without subscribed devices", async () => {
    const { scheduler, api } = setup("13:00");
    expect(await scheduler.tick()).toBe(0);
    expect(api.clock).not.toHaveBeenCalled();
  });

  it("sends a due meal reminder once, and reads Nutrition only when something is due", async () => {
    const { store, scheduler, sender, api } = setup("13:02");
    store.addSubscription(device);
    expect(await scheduler.tick()).toBe(1);
    expect(sender.send.mock.calls[0]![1]).toMatchObject({ title: "Pranzo · 13:00" });
    expect(api.mealsByDate).toHaveBeenCalledTimes(1);
    expect(api.goalProgress).not.toHaveBeenCalled();
    // Same minute window: already sent
    expect(await scheduler.tick()).toBe(0);
    expect(api.mealsByDate).toHaveBeenCalledTimes(1);
  });

  it("skips the reminder when the meal is already logged, and removes devices that unsubscribed", async () => {
    const lunch: Meal = {
      id: "m1", date: "2026-11-05", time: "12:50", type: "lunch", description: "Pranzo", notes: null, items: [],
      nutrients: { kcal: 600, protein: 30, carbs: 60, fat: 20, saturatedFat: null, transFat: null, fiber: 5, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null },
    };
    const logged = setup("13:02", [lunch]);
    logged.store.addSubscription(device);
    expect(await logged.scheduler.tick()).toBe(0);
    expect(logged.sender.send).not.toHaveBeenCalled();

    const gone = setup("16:01");
    gone.store.addSubscription(device);
    gone.sender.send.mockResolvedValue("gone");
    await gone.scheduler.tick();
    expect(gone.store.subscriptions()).toEqual([]);
  });

  it("logs a failed check and retries next minute", async () => {
    const { store, scheduler, api } = setup("13:02");
    store.addSubscription(device);
    api.mealsByDate.mockRejectedValueOnce(new Error("rate limited"));
    expect(await scheduler.tick()).toBe(0);
    expect(await scheduler.tick()).toBe(1);
  });
});

describe("push routes", () => {
  async function setup() {
    const store = new ReminderStore(openDatabase(":memory:"));
    const sendAll = vi.fn(async () => 1);
    const app = await buildApp({ auth: authOptions(), push: { store, scheduler: { sendAll }, publicKey: "public-key" } });
    const { cookie } = await signIn(app);
    return { app, store, sendAll, headers: { cookie } };
  }

  it("requires sign-in", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/api/push" })).statusCode).toBe(401);
  });

  it("subscribes and unsubscribes a device, saves settings and sends a test", async () => {
    const { app, store, sendAll, headers } = await setup();
    const status = await app.inject({ method: "GET", url: "/api/push", headers });
    expect(status.json()).toEqual({ publicKey: "public-key", devices: 0, settings: all });

    const body = { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } };
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", headers, payload: body })).json().devices).toBe(1);
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", headers, payload: { ...body, endpoint: "http://x" } })).statusCode).toBe(400);

    const settings = { meal: true, todo: false, water: true, summary: false };
    expect((await app.inject({ method: "PUT", url: "/api/push/settings", headers, payload: settings })).json().settings).toEqual(settings);
    expect(store.settings()).toEqual(settings);

    expect((await app.inject({ method: "POST", url: "/api/push/test", headers })).json()).toEqual({ sent: 1 });
    expect(sendAll).toHaveBeenCalledOnce();

    expect((await app.inject({ method: "DELETE", url: "/api/push/subscriptions", headers, payload: { endpoint: body.endpoint } })).json().devices).toBe(0);
  });
});
