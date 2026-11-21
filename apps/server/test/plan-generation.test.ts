import { describe, expect, it, vi } from "vitest";
import { WEEKDAYS, defaultPlanPreferences, type GeneratedPlan, type PlanDraft } from "@intake/shared";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { NeedsStore } from "../src/db/needsStore.js";
import { PlanGenerationStore } from "../src/db/planGenerationStore.js";
import { PlanStore } from "../src/db/planStore.js";
import { blockedBy } from "../src/routes/features.js";
import { RecognitionError } from "../src/services/mealRecognition.js";
import { PlanGenerator } from "../src/services/planGenerator.js";
import { authOptions, signIn } from "./helpers.js";

const prefs = defaultPlanPreferences();
const targets = { kcal: 2000, protein: 135, carbs: 230, fat: 65, fiber: 30 };

/** A week of the default slots; `kcalScale` moves every meal's calories (1 gives 2000 kcal and 135 g protein a day). */
function answer(kcalScale = 1): GeneratedPlan {
  return {
    notes: [],
    days: WEEKDAYS.map((day, d) => ({
      day,
      note: "",
      meals: prefs.slots.map((slot, s) => {
        const base = slot.type === "breakfast" ? [400, 25] : slot.type === "snack" ? [200, 15] : [600, 40];
        return {
          slot: slot.id,
          free: false,
          description: `${slot.label} ${day}`,
          foods: [{ name: s === 0 ? "Yogurt" : `Cibo ${d}-${s}`, quantity: 100, unit: "g" }],
          macros: { kcal: base[0]! * kcalScale, protein: base[1]!, carbs: 40, fat: 12, fiber: 5, sugar: 8, addedSugar: 1 },
        };
      }),
    })),
  };
}

/** Stands in for client.messages: each stream() returns the next text, sent as one "text" event. */
function fakeClient(texts: string[], stopReason = "end_turn") {
  let call = 0;
  const stream = vi.fn(() => {
    const text = texts[call++] ?? "";
    const handlers: Array<(delta: string) => void> = [];
    const s = {
      on(event: string, handler: (delta: string) => void) {
        if (event === "text") handlers.push(handler);
        return s;
      },
      async finalMessage() {
        for (const handler of handlers) handler(text);
        return { stop_reason: stopReason, content: [{ type: "text", text }], usage: { input_tokens: 4000, output_tokens: 9000 } };
      },
    };
    return s;
  });
  return { stream };
}

const input = { preferences: prefs, targets, profile: null, recentMeals: [], validFrom: "2026-11-23" };

describe("PlanGenerator", () => {
  it("returns the plan when the first answer is on target, streaming with a structured output", async () => {
    const client = fakeClient([JSON.stringify(answer())]);
    const progress = vi.fn();
    const generator = new PlanGenerator({ apiKey: "sk-test", model: () => "claude-sonnet-5-5", client: client as never });
    const draft = await generator.generate(input, progress);
    expect(draft.rounds).toBe(1);
    expect(draft.checks.days.every((d) => d.onTarget)).toBe(true);
    expect(draft.plan.days.monday.meals).toHaveLength(5);
    expect(progress).toHaveBeenLastCalledWith(1, 7);
    const sent = (client.stream.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(sent.messages[0].content).toContain('"kcal": 2000');
  });

  it("sends the problems back once when a day misses its targets, and returns the corrected plan", async () => {
    const client = fakeClient([JSON.stringify(answer(1.3)), JSON.stringify(answer())]);
    const generator = new PlanGenerator({ apiKey: "sk-test", model: () => "claude-sonnet-5-5", client: client as never });
    const draft = await generator.generate(input);
    expect(draft.rounds).toBe(2);
    expect(draft.checks.days.every((d) => d.onTarget)).toBe(true);
    const second = (client.stream.mock.calls[1] as unknown as [Record<string, any>])[0];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe("assistant");
    expect(second.messages[2].content).toContain("monday: 2600 kcal");
  });

  it("keeps the remaining problems after the correction round instead of looping", async () => {
    const client = fakeClient([JSON.stringify(answer(1.3)), JSON.stringify(answer(1.3))]);
    const generator = new PlanGenerator({ apiKey: "sk-test", model: () => "claude-sonnet-5-5", client: client as never });
    const draft = await generator.generate(input);
    expect(client.stream).toHaveBeenCalledTimes(2);
    expect(draft.checks.days.every((d) => d.onTarget === false)).toBe(true);
  });

  it("replaces one meal in its slot and time, sending the other dishes and the wish", async () => {
    const plan = (await new PlanGenerator({ apiKey: "k", model: () => "m", client: fakeClient([JSON.stringify(answer())]) as never }).generate(input)).plan;
    const meal = { slot: "x", free: false, description: "Insalata di ceci", foods: [{ name: "Ceci", quantity: 150, unit: "g" }], macros: { kcal: 590, protein: 38, carbs: 50, fat: 15, fiber: 12, sugar: 4, addedSugar: 0 } };
    const client = fakeClient([JSON.stringify(meal)]);
    const generator = new PlanGenerator({ apiKey: "k", model: () => "m", client: client as never });
    const replaced = await generator.replaceMeal({ preferences: prefs, targets, plan, day: "monday", index: 2, note: "più leggero" });
    expect(replaced).toMatchObject({ title: plan.days.monday.meals[2]!.title, time: plan.days.monday.meals[2]!.time, description: "Insalata di ceci", macros: { kcal: 590 } });
    const sent = (client.stream.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(sent.messages[0].content).toContain("più leggero");
    expect(sent.messages[0].content).toContain("Pranzo tuesday");
    expect(sent.output_config.format.schema.properties.foods).toBeDefined();
  });

  it("turns refusals, cut and malformed answers into RecognitionError", async () => {
    const make = (texts: string[], stop?: string) => new PlanGenerator({ apiKey: "k", model: () => "m", client: fakeClient(texts, stop) as never });
    await expect(make(["{}"], "refusal").generate(input)).rejects.toMatchObject({ reason: "refused" });
    await expect(make(["{"], "max_tokens").generate(input)).rejects.toMatchObject({ reason: "unreadable" });
    await expect(make(["not json"]).generate(input)).rejects.toBeInstanceOf(RecognitionError);
    await expect(make([JSON.stringify({ notes: [], days: [] })]).generate(input)).rejects.toMatchObject({ reason: "unreadable" });
  });
});

const timedPlan = (job: { draft: { plan: any } }) => job.draft.plan;

describe("plan generation routes", () => {
  function setup(generator?: { generate: (...args: any[]) => Promise<PlanDraft>; replaceMeal?: (...args: any[]) => Promise<any> }) {
    const db = openDatabase(":memory:");
    const plans = new PlanStore(db);
    const store = new PlanGenerationStore(db);
    const api = {
      clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-21", localTime: "10:00:00", utc: "2026-11-21T09:00:00Z" }),
      goals: async () => ({ ...targets, waterMl: 2500, limits: {} }) as never,
      weightTrends: async () => ({ unit: "kg", target: null, entries: [{ date: "2026-11-20", weight: 75 }] }),
      mealsByRange: vi.fn(async () => ({ timezone: null, meals: [{ description: "Pasta al pomodoro" }, { description: "Pasta al pomodoro" }, { description: "Insalata di farro" }] }) as never),
    };
    return { plans, store, api, generator };
  }

  async function signedIn(deps: ReturnType<typeof setup>) {
    const app = await buildApp({ auth: authOptions(), planGeneration: { api: deps.api as never, plans: deps.plans, store: deps.store, needs: new NeedsStore(openDatabase(":memory:")), generator: deps.generator as never } });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("offers the default preferences and the plan model, and keeps valid preferences only", async () => {
    const deps = setup();
    const { app, headers } = await signedIn(deps);
    const view = (await app.inject({ method: "GET", url: "/api/plans/generation", headers })).json();
    expect(view).toMatchObject({ model: "claude-sonnet-5-5", targets: { kcal: 2000, protein: 135 } });
    expect(view.preferences.slots).toHaveLength(5);
    expect((await app.inject({ method: "PUT", url: "/api/plans/generation/preferences", headers, payload: { ...prefs, maxSameMealPerWeek: 0 } })).statusCode).toBe(400);
    const saved = await app.inject({ method: "PUT", url: "/api/plans/generation/preferences", headers, payload: { ...prefs, dislikes: ["Funghi"] } });
    expect(saved.json().preferences.dislikes).toEqual(["funghi"]);
    expect((await app.inject({ method: "PUT", url: "/api/plans/generation/model", headers, payload: { model: "gpt-4" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/plans/generation/model", headers, payload: { model: "claude-opus-5-5" } })).json().model).toBe("claude-opus-5-5");
  });

  it("runs the generation in the background, then activates the draft as a new plan version", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const generate = vi.fn(async (genInput: any, progress: (round: number, days: number) => void) => {
      progress(1, 3);
      await gate;
      const generator = new PlanGenerator({ apiKey: "k", model: () => "m", client: fakeClient([JSON.stringify(answer())]) as never });
      return generator.generate(genInput);
    });
    const deps = setup({ generate });
    const { app, headers } = await signedIn(deps);
    await app.inject({ method: "PUT", url: "/api/plans/generation/preferences", headers, payload: { ...prefs, learnFromMeals: true } });

    const started = await app.inject({ method: "POST", url: "/api/plans/generate", headers });
    expect(started.statusCode).toBe(202);
    const { id } = started.json();
    expect((await app.inject({ method: "POST", url: "/api/plans/generate", headers })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/api/plans/generate/${id}`, headers })).json()).toMatchObject({ status: "running", daysDone: 3, draft: null });
    // "Impara dai miei pasti": the recent meals, without repeats
    expect(generate.mock.calls[0]![0].recentMeals).toEqual(["Pasta al pomodoro", "Insalata di farro"]);
    expect(generate.mock.calls[0]![0].profile).toBeNull();

    release();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: `/api/plans/generate/${id}`, headers })).json().status).toBe("done"));
    expect((await app.inject({ method: "POST", url: `/api/plans/generate/${id}/activate`, headers, payload: { validFrom: "23/11" } })).statusCode).toBe(400);
    const activated = await app.inject({ method: "POST", url: `/api/plans/generate/${id}/activate`, headers, payload: { validFrom: "2026-11-23" } });
    expect(activated.statusCode).toBe(201);
    expect(deps.plans.activeOn("2026-11-23")?.plan.days.friday.meals).toHaveLength(5);
    expect((await app.inject({ method: "GET", url: `/api/plans/generate/${id}`, headers })).statusCode).toBe(404);
  });

  it("changes times and replaces a meal of the draft, running the checks again", async () => {
    const real = new PlanGenerator({ apiKey: "k", model: () => "m", client: fakeClient([JSON.stringify(answer())]) as never });
    const replaceMeal = vi.fn(async ({ plan, day, index }: any) => ({ ...plan.days[day].meals[index], description: "Funghi trifolati", foods: [{ name: "Funghi", quantity: 200, unit: "g" }] }));
    const deps = setup({ generate: (i: any) => real.generate(i), replaceMeal });
    const { app, headers } = await signedIn(deps);
    await app.inject({ method: "PUT", url: "/api/plans/generation/preferences", headers, payload: { ...prefs, dislikes: ["funghi"] } });
    const { id } = (await app.inject({ method: "POST", url: `/api/plans/generate`, headers })).json();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: `/api/plans/generate/${id}`, headers })).json().status).toBe("done"));

    expect((await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/time`, headers, payload: { day: "monday", index: 0, time: "7.30", allDays: true } })).statusCode).toBe(400);
    const timed = (await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/time`, headers, payload: { day: "monday", index: 0, time: "07:30", allDays: true } })).json();
    expect(timed.draft.plan.days.sunday.meals[0].time).toBe("07:30");
    const one = (await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/time`, headers, payload: { day: "friday", index: 4, time: "21:00", allDays: false } })).json();
    expect([one.draft.plan.days.friday.meals[4].time, one.draft.plan.days.monday.meals[4].time]).toEqual(["21:00", prefs.slots[4]!.time]);

    const before = timedPlan(one);
    const swapped = (await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/swap`, headers, payload: { day: "monday", index: 2, toDay: "friday" } })).json();
    expect(swapped.draft.plan.days.monday.meals[2].description).toBe(before.days.friday.meals[2].description);
    expect(swapped.draft.plan.days.friday.meals[2].description).toBe(before.days.monday.meals[2].description);
    expect(swapped.draft.checks.days).toHaveLength(7);
    expect((await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/swap`, headers, payload: { day: "monday", index: 2, toDay: "monday" } })).statusCode).toBe(400);

    const edited = await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/meal`, headers, payload: { day: "monday", index: 2, description: "Funghi e riso", foods: [{ name: "Funghi", quantity: 100, unit: "g" }], macros: { kcal: 500, protein: 20, carbs: 70, fat: 10, fiber: 6 } } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().draft.plan.days.monday.meals[2].description).toBe("Funghi e riso");
    expect(edited.json().draft.checks.violations.some((v: { kind: string; day?: string }) => v.kind === "disliked" && v.day === "monday")).toBe(true);
    expect((await app.inject({ method: "PATCH", url: `/api/plans/generate/${id}/meal`, headers, payload: { day: "monday", index: 2, description: "x", foods: [] } })).statusCode).toBe(400);

    const replaced = await app.inject({ method: "POST", url: `/api/plans/generate/${id}/replace`, headers, payload: { day: "monday", index: 2, note: "" } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().draft.plan.days.monday.meals[2].description).toBe("Funghi trifolati");
    expect(replaced.json().draft.checks.violations.some((v: { kind: string }) => v.kind === "disliked")).toBe(true);
    expect(replaceMeal.mock.calls[0]![0].preferences.dislikes).toEqual(["funghi"]);
    expect((await app.inject({ method: "POST", url: `/api/plans/generate/${id}/replace`, headers, payload: { day: "monday", index: 9, note: "" } })).statusCode).toBe(400);
    replaceMeal.mockRejectedValueOnce(new RecognitionError("busy", "overloaded"));
    expect((await app.inject({ method: "POST", url: `/api/plans/generate/${id}/replace`, headers, payload: { day: "monday", index: 2, note: "" } })).statusCode).toBe(503);
  });

  it("reports a failed generation with the recognition code, answers 503 without a key, and hides with the part", async () => {
    const deps = setup({ generate: async () => Promise.reject(new RecognitionError("credit", "no credit")) });
    const { app, headers } = await signedIn(deps);
    const { id } = (await app.inject({ method: "POST", url: "/api/plans/generate", headers })).json();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: `/api/plans/generate/${id}`, headers })).json()).toMatchObject({ status: "failed", error: "recognition_credit" }));

    const noKey = await signedIn(setup());
    expect((await noKey.app.inject({ method: "POST", url: "/api/plans/generate", headers: noKey.headers })).statusCode).toBe(503);
    const off = { training: true, health: true, reminders: true, water: true, photoMeals: false };
    expect(blockedBy("/api/plans/generate", (key) => off[key])).toBe("photoMeals");
    expect(blockedBy("/api/plans/generation/preferences", (key) => off[key])).toBe("photoMeals");
    expect(blockedBy("/api/plans", (key) => off[key])).toBeNull();
  });
});
