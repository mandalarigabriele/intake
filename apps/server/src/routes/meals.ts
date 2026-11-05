import { MEAL_TYPES } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isValidDate } from "../services/dayView.js";
import { copyMealFields, recentDistinctMeals, updateMealFields } from "../services/mealWrites.js";

export interface MealRoutesOptions {
  api: Pick<NutritionApi, "clock" | "mealsByDate" | "mealsByRange" | "logMeal" | "updateMeal" | "deleteMeal" | "saveMeal">;
  requireOwner: preHandlerHookHandler;
}

const date = z.string().refine(isValidDate, "Invalid date");
const nullableNumber = z.number().nonnegative().nullable();

const nutrientsSchema = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  saturatedFat: nullableNumber,
  transFat: nullableNumber,
  fiber: nullableNumber,
  sugar: nullableNumber,
  addedSugar: nullableNumber,
  alcohol: nullableNumber,
  caffeineMg: nullableNumber,
  sodiumMg: nullableNumber,
});

const updateSchema = z
  .object({
    date,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    type: z.enum(MEAL_TYPES),
    description: z.string().trim().min(1).max(2000),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          quantity: z.number().positive().nullable(),
          unit: z.string().trim().max(40).nullable(),
          nutrients: nutrientsSchema,
        }),
      )
      .max(30)
      .optional(),
    totals: z.object({ kcal: z.number().nonnegative(), protein: z.number().nonnegative(), carbs: z.number().nonnegative(), fat: z.number().nonnegative() }).optional(),
  })
  .refine((body) => (body.items && body.items.length > 0) || body.totals, "Items or totals are required");

const repeatSchema = z.object({ date, idempotencyKey: z.string().min(8).max(255) });
const favoriteSchema = z.object({ name: z.string().trim().min(1).max(100) });

function shiftDate(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Logged meals under /api/meals: edit, delete, save as favorite, repeat. */
export const mealRoutes: FastifyPluginAsync<MealRoutesOptions> = async (app, { api, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  // Distinct meals of the last two weeks, for "Ripeti un pasto recente"
  app.get("/meals/recent", async () => {
    const today = (await api.clock()).localDate;
    const { meals } = await api.mealsByRange(shiftDate(today, -13), today);
    return { meals: recentDistinctMeals(meals, 8) };
  });

  app.patch<{ Params: { id: string } }>("/meals/:id", async (request, reply) => {
    const body = updateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid meal", issues: body.error.issues.map((i) => i.message) });
    await api.updateMeal(request.params.id, updateMealFields(body.data));
    return { ok: true };
  });

  // Deleting is confirmed in the UI; it removes the meal from Nutrition (and from Claude's view of it)
  app.delete<{ Params: { id: string } }>("/meals/:id", async (request) => {
    await api.deleteMeal(request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/meals/:id/favorite", async (request, reply) => {
    const body = favoriteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid name" });
    await api.saveMeal(body.data.name, request.params.id);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/meals/:id/repeat", async (request, reply) => {
    const body = repeatSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const { meals } = await api.mealsByDate(body.data.date);
    const meal = meals.find((m) => m.id === request.params.id);
    if (!meal) return reply.code(404).send({ error: "Meal not found" });
    const result = await api.logMeal({ ...copyMealFields(meal), idempotency_key: body.data.idempotencyKey });
    return reply.code(201).send({ mealId: result.id });
  });
};
