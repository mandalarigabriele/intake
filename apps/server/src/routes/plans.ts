import { WEEKDAYS, importPlan, mealPlanSchema, plannedFoodSchema, editMeal, mealEditSchema, mealMoveSchema, mealTimeChangeSchema, setMealTime, swapMeals, type PlanUploadError, type PlansResponse } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";

export interface PlanRoutesOptions {
  plans: PlanStore;
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
}

const startSchema = z.object({ validFrom: z.iso.date() }).strict();
const splitWeekConfirmSchema = z
  .object({
    days: z
      .array(z.object({ day: z.enum(WEEKDAYS), meals: z.array(z.object({ index: z.number().int().min(0).max(9), foods: z.array(plannedFoodSchema).min(1).max(20) })).min(1) }))
      .min(1)
      .max(7),
  })
  .strict();

const splitConfirmSchema = z
  .object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), foods: z.array(plannedFoodSchema).min(1).max(20) })
  .strict();

/** Meal plan versions under /api/plans. */
export const planRoutes: FastifyPluginAsync<PlanRoutesOptions> = async (app, { plans, api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/plans", async (): Promise<PlansResponse> => {
    const today = (await api.clock()).localDate;
    return { active: plans.activeOn(today), versions: plans.versions(today), today };
  });

  app.get<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const plan = plans.get(Number(request.params.id));
    return plan ?? reply.code(404).send({ error: "Plan not found" });
  });

  // Piano: a scheduled version starts on another day, e.g. today ("Applica da oggi"); versions already in effect keep their date
  app.patch<{ Params: { id: string } }>("/plans/:id/start", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = startSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_date" });
    const today = (await api.clock()).localDate;
    if (stored.validFrom <= today) return reply.code(409).send({ error: "plan_already_started" });
    const plan = { ...stored.plan, validFrom: body.data.validFrom };
    plans.update(stored.id, plan);
    return { ...stored, validFrom: body.data.validFrom, plan };
  });

  // Confirms the split: the foods of the meal get their values, the meal keeps its totals. Saved as the same version.
  app.patch<{ Params: { id: string } }>("/plans/:id/split-foods", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = splitConfirmSchema.safeParse(request.body);
    const current = body.success ? stored.plan.days[body.data.day].meals[body.data.index] : undefined;
    if (!body.success || !current || current.free || body.data.foods.length !== current.foods.length) return reply.code(400).send({ error: "invalid_split" });
    const meals = stored.plan.days[body.data.day].meals.map((meal, i) => (i === body.data.index && !meal.free ? { ...meal, foods: body.data.foods } : meal));
    const plan = mealPlanSchema.parse({ ...stored.plan, days: { ...stored.plan.days, [body.data.day]: { ...stored.plan.days[body.data.day], meals } } });
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Confirms a whole-week split: every meal listed gets its foods' values, in one version (the totals stay)
  app.patch<{ Params: { id: string } }>("/plans/:id/split-foods/week", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = splitWeekConfirmSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_split" });
    const days = { ...stored.plan.days };
    for (const entry of body.data.days) {
      const current = days[entry.day].meals;
      const meals = [...current];
      for (const meal of entry.meals) {
        const target = current[meal.index];
        if (!target || target.free || meal.foods.length !== target.foods.length) return reply.code(400).send({ error: "invalid_split" });
        meals[meal.index] = { ...target, foods: meal.foods };
      }
      days[entry.day] = { ...days[entry.day], meals };
    }
    const plan = mealPlanSchema.parse({ ...stored.plan, days });
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: a meal time changed on one day or on every day of a stored version (it stays the same version)
  app.patch<{ Params: { id: string } }>("/plans/:id/time", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealTimeChangeSchema.safeParse(request.body);
    if (!body.success || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_time" });
    const plan = setMealTime(stored.plan, body.data.day, body.data.index, body.data.time, body.data.allDays);
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: a dish swapped with the same meal of another day (the version stays the same)
  app.patch<{ Params: { id: string } }>("/plans/:id/swap", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealMoveSchema.safeParse(request.body);
    if (!body.success || body.data.day === body.data.toDay || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_move" });
    const plan = swapMeals(stored.plan, body.data.day, body.data.index, body.data.toDay);
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: one dish edited by hand (text, foods, main nutrients); the version stays the same
  app.patch<{ Params: { id: string } }>("/plans/:id/meal", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealEditSchema.safeParse(request.body);
    if (!body.success || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_meal" });
    let plan;
    try {
      plan = editMeal(stored.plan, body.data);
    } catch {
      return reply.code(400).send({ error: "invalid_meal" });
    }
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Plans are generated by Claude Fitness and uploaded as JSON (well under the default 1 MB body limit).
  // Both the Claude Fitness format and Intake's own format are accepted.
  app.post("/plans", async (request, reply) => {
    const result = importPlan(request.body);
    if (!result.success) {
      const body: PlanUploadError = { error: "invalid_plan", issues: result.issues };
      return reply.code(400).send(body);
    }
    return reply.code(201).send(plans.add(result.plan));
  });
};
