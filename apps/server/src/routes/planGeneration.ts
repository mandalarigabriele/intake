import { randomUUID } from "node:crypto";
import {
  PLAN_MODELS,
  checkPlan,
  mealMoveSchema,
  mealReplaceSchema,
  mealTimeChangeSchema,
  replaceMeal,
  setMealTime,
  swapMeals,
  type PlanPreferences,
  addDaysTo,
  defaultPlanPreferences,
  planPreferencesSchema,
  slotsFromPlan,
  weightUnitOf,
  type PlanGenerationJob,
  type PlanGenerationView,
  type PlanTargets,
} from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NeedsStore } from "../db/needsStore.js";
import type { PlanGenerationStore } from "../db/planGenerationStore.js";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { RecognitionError } from "../services/mealRecognition.js";
import type { PlanGenerator } from "../services/planGenerator.js";

export interface PlanGenerationRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goals" | "weightTrends" | "mealsByRange">;
  plans: PlanStore;
  store: PlanGenerationStore;
  needs: NeedsStore;
  /** Present with ANTHROPIC_API_KEY. */
  generator?: Pick<PlanGenerator, "generate" | "replaceMeal">;
  requireOwner: preHandlerHookHandler;
}

/** A draft is kept this long for "Attiva"; a server restart drops it (nothing is saved until then). */
const JOB_TTL_MS = 60 * 60_000;
const RECENT_MEAL_DAYS = 14;
const RECENT_MEALS_MAX = 40;
const LB_TO_KG = 0.45359237;

const activateSchema = z.object({ validFrom: z.iso.date() }).strict();

/**
 * "Genera con l'IA" (Piano, part Pasti da foto): preferences, the plan model, and the generation as a background job
 * (a week takes longer than a proxy waits for one request), then "Attiva" saves the draft as a new plan version.
 * Rules in docs/plan-generation.md.
 */
export const planGenerationRoutes: FastifyPluginAsync<PlanGenerationRoutesOptions> = async (app, { api, plans, store, needs, generator, requireOwner }) => {
  app.addHook("preHandler", requireOwner);
  type Job = PlanGenerationJob & { createdAt: number; preferences: PlanPreferences; replacing: boolean };
  const jobs = new Map<string, Job>();
  const publicJob = ({ createdAt: _c, preferences: _p, replacing: _r, ...rest }: Job): PlanGenerationJob => rest;
  const prune = () => {
    for (const [id, job] of jobs) if (Date.now() - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  };

  async function targets(): Promise<PlanTargets> {
    const goals = await api.goals();
    return { kcal: goals.kcal, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, fiber: goals.fiber };
  }

  async function view(): Promise<PlanGenerationView> {
    const today = (await api.clock()).localDate;
    const stored = store.get();
    const preferences = stored.preferences ?? defaultPlanPreferences(slotsFromPlan(plans.activeOn(today)?.plan) ?? undefined);
    return { preferences, targets: await targets(), model: stored.model, models: [...PLAN_MODELS] };
  }

  app.get("/plans/generation", async () => view());

  app.put("/plans/generation/preferences", async (request, reply) => {
    const body = planPreferencesSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_preferences" });
    store.setPreferences(body.data);
    return view();
  });

  app.put("/plans/generation/model", async (request, reply) => {
    const model = (request.body as { model?: unknown } | null)?.model;
    if (typeof model !== "string" || !store.setModel(model)) return reply.code(400).send({ error: "invalid_model" });
    return view();
  });

  // Starts a generation with the stored preferences; one at a time
  app.post("/plans/generate", async (_request, reply) => {
    if (!generator) return reply.code(503).send({ error: "recognition_not_configured" });
    prune();
    if ([...jobs.values()].some((job) => job.status === "running")) return reply.code(409).send({ error: "generation_running" });
    const today = (await api.clock()).localDate;
    const stored = store.get();
    const preferences = stored.preferences ?? defaultPlanPreferences(slotsFromPlan(plans.activeOn(today)?.plan) ?? undefined);
    const [goalTargets, weight] = await Promise.all([targets(), api.weightTrends(30, today)]);
    const latest = weight.entries.at(-1);
    const weightKg = latest ? Math.round(latest.weight * (weightUnitOf(weight.unit) === "lb" ? LB_TO_KG : 1) * 10) / 10 : null;
    const profile = needs.get().profile;
    let recentMeals: string[] = [];
    if (preferences.learnFromMeals) {
      const { meals } = await api.mealsByRange(addDaysTo(today, -RECENT_MEAL_DAYS), addDaysTo(today, -1));
      recentMeals = [...new Set(meals.map((m) => m.description.trim()).filter(Boolean))].slice(0, RECENT_MEALS_MAX);
    }
    const id = randomUUID();
    const job: Job = { id, status: "running", daysDone: 0, round: 1, error: null, draft: null, createdAt: Date.now(), preferences, replacing: false };
    jobs.set(id, job);
    const input = {
      preferences,
      targets: goalTargets,
      profile: profile ? { sex: profile.sex, age: profile.age, heightCm: profile.heightCm, weightKg, goal: profile.goal } : null,
      recentMeals,
      validFrom: addDaysTo(today, 1),
    };
    // Runs after the answer; the app asks for the job every few seconds
    void generator
      .generate(input, (round, daysDone) => {
        job.round = round;
        job.daysDone = daysDone;
      })
      .then((draft) => {
        job.draft = draft;
        job.status = "done";
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.error = error instanceof RecognitionError ? `recognition_${error.reason}` : "recognition_failed";
        app.log.warn({ reason: job.error, err: (error as Error)?.message }, "plan generation failed");
      });
    return reply.code(202).send({ id });
  });

  app.get<{ Params: { id: string } }>("/plans/generate/:id", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "not_found" });
    return publicJob(job);
  });

  // Before "Attiva": a meal time changed on one day or on every day of the draft
  app.patch<{ Params: { id: string } }>("/plans/generate/:id/time", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job?.draft) return reply.code(404).send({ error: "not_found" });
    const body = mealTimeChangeSchema.safeParse(request.body);
    if (!body.success || !job.draft.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_time" });
    job.draft = { ...job.draft, plan: setMealTime(job.draft.plan, body.data.day, body.data.index, body.data.time, body.data.allDays) };
    return publicJob(job);
  });

  // "Sposta": a dish swapped with the same meal of another day; the checks are run again
  app.patch<{ Params: { id: string } }>("/plans/generate/:id/swap", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job?.draft) return reply.code(404).send({ error: "not_found" });
    const body = mealMoveSchema.safeParse(request.body);
    if (!body.success || body.data.day === body.data.toDay || !job.draft.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_move" });
    const plan = swapMeals(job.draft.plan, body.data.day, body.data.index, body.data.toDay);
    job.draft = { ...job.draft, plan, checks: checkPlan(plan, job.draft.targets, job.preferences) };
    return publicJob(job);
  });

  // "Sostituisci": another dish for one meal of the draft; the checks are run again
  app.post<{ Params: { id: string } }>("/plans/generate/:id/replace", async (request, reply) => {
    if (!generator) return reply.code(503).send({ error: "recognition_not_configured" });
    const job = jobs.get(request.params.id);
    if (!job?.draft) return reply.code(404).send({ error: "not_found" });
    const body = mealReplaceSchema.safeParse(request.body);
    const current = body.success ? job.draft.plan.days[body.data.day].meals[body.data.index] : undefined;
    if (!body.success || !current || current.free) return reply.code(400).send({ error: "invalid_meal" });
    if (job.replacing) return reply.code(409).send({ error: "generation_running" });
    job.replacing = true;
    try {
      const meal = await generator.replaceMeal({ preferences: job.preferences, targets: job.draft.targets, plan: job.draft.plan, day: body.data.day, index: body.data.index, note: body.data.note });
      const plan = replaceMeal(job.draft.plan, body.data.day, body.data.index, meal);
      job.draft = { ...job.draft, plan, checks: checkPlan(plan, job.draft.targets, job.preferences) };
      return publicJob(job);
    } catch (error) {
      if (!(error instanceof RecognitionError)) throw error;
      request.log.warn({ reason: error.reason }, error.message);
      return reply.code(error.reason === "credit" ? 402 : error.reason === "busy" ? 503 : error.reason === "refused" ? 422 : 502).send({ error: `recognition_${error.reason}` });
    } finally {
      job.replacing = false;
    }
  });

  // "Attiva dal …": the draft becomes a new plan version; the previous ones stay in Storico versioni
  app.post<{ Params: { id: string } }>("/plans/generate/:id/activate", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job?.draft) return reply.code(404).send({ error: "not_found" });
    const body = activateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_date" });
    const stored = plans.add({ ...job.draft.plan, validFrom: body.data.validFrom });
    jobs.delete(job.id);
    return reply.code(201).send(stored);
  });
};
