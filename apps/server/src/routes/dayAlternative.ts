import { addDaysTo, dayAlternativeRequestSchema, dayBudget, defaultPlanPreferences, slotsFromPlan, weekdayOf, WEEKDAYS, type DayAlternative, type DayMacros } from "@intake/shared";
import type { FastifyPluginAsync, FastifyReply, preHandlerHookHandler } from "fastify";
import type { PlanGenerationStore } from "../db/planGenerationStore.js";
import type { PlanStore } from "../db/planStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { RecognitionError } from "../services/mealRecognition.js";
import { plannedEntries } from "../services/planMatching.js";
import type { PlanGenerator } from "../services/planGenerator.js";

export interface DayAlternativeRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goalProgress" | "mealsByDate" | "summary">;
  plans: Pick<PlanStore, "activeOn" | "linksOn" | "skipsOn">;
  store: Pick<PlanGenerationStore, "get">;
  /** Present with ANTHROPIC_API_KEY. */
  generator?: Pick<PlanGenerator, "suggestForDay">;
  requireOwner: preHandlerHookHandler;
}

const failed = (reply: FastifyReply, error: RecognitionError) =>
  reply.code(error.reason === "credit" ? 402 : error.reason === "busy" ? 503 : error.reason === "refused" ? 422 : 502).send({ error: `recognition_${error.reason}` });

const KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const zero = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

/**
 * "Alternativa" in the Timeline and in Oggi's next meal: another dish for a planned meal of today only, sized on what
 * is left of the day's goals (goals − eaten − the other meals still planned), looked at against the week so far and
 * against the WHO healthy diet guidance, with an optional hint ("ho zucchine e uova"). Nothing is saved: the app shows
 * it and the person logs it on the meal screen. docs/day-alternative.md
 */
export const dayAlternativeRoutes: FastifyPluginAsync<DayAlternativeRoutesOptions> = async (app, { api, plans, store, generator, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.post("/days/today/alternative", async (request, reply) => {
    if (!generator) return reply.code(503).send({ error: "recognition_not_configured" });
    const body = dayAlternativeRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const clock = await api.clock();
    const date = clock.localDate;
    const stored = plans.activeOn(date);
    if (!stored) return reply.code(404).send({ error: "no_plan" });

    const [progress, parsed] = await Promise.all([api.goalProgress(date), api.mealsByDate(date)]);
    const meals = [...parsed.meals].sort((a, b) => a.time.localeCompare(b.time));
    const entries = plannedEntries(stored, meals, plans.linksOn(date), { date, today: date, now: clock.localTime }, plans.skipsOn(date));
    const entry = entries.find((e) => e.index === body.data.index);
    // Only a meal still to eat: not eaten (covered by a logged meal), skipped or free
    if (!entry || (entry.status !== "todo" && entry.status !== "planned")) return reply.code(409).send({ error: "meal_not_open" });

    const reserved = { ...zero };
    const otherMealsLeft: Array<{ title: string; kcal: number | null; protein: number | null }> = [];
    for (const other of entries) {
      if (other.index === entry.index || (other.status !== "todo" && other.status !== "planned")) continue;
      otherMealsLeft.push({ title: other.title, kcal: other.macros?.kcal ?? null, protein: other.macros?.protein ?? null });
      for (const key of KEYS) reserved[key] += other.macros?.[key] ?? 0;
    }
    const goals: DayMacros = { kcal: progress.goals.kcal, protein: progress.goals.protein, carbs: progress.goals.carbs, fat: progress.goals.fat, fiber: progress.goals.fiber };
    const eaten = { kcal: progress.totals.kcal, protein: progress.totals.protein, carbs: progress.totals.carbs, fat: progress.totals.fat, fiber: progress.totals.fiber };
    const own = entry.macros ? { kcal: entry.macros.kcal, protein: entry.macros.protein, carbs: entry.macros.carbs, fat: entry.macros.fat, fiber: entry.macros.fiber } : null;
    const budget = dayBudget(goals, eaten, reserved, own);

    // The week so far (Monday to yesterday), when there is one; a failure here only drops that hint
    let week: { days: number; avgKcal: number; avgProtein: number } | null = null;
    const monday = addDaysTo(date, -WEEKDAYS.indexOf(weekdayOf(date)));
    if (monday < date) {
      try {
        const done = (await api.summary(monday, addDaysTo(date, -1))).days.filter((d) => d.mealCount > 0);
        if (done.length > 0) week = { days: done.length, avgKcal: Math.round(done.reduce((s, d) => s + d.kcal, 0) / done.length), avgProtein: Math.round(done.reduce((s, d) => s + d.protein, 0) / done.length) };
      } catch {
        week = null;
      }
    }

    const day = stored.plan.days[weekdayOf(date)];
    const planned = day.meals[entry.index];
    const currentDish = planned && !planned.free ? (planned.description ?? entry.foods) : null;
    try {
      const preferences = store.get().preferences ?? defaultPlanPreferences(slotsFromPlan(stored.plan) ?? undefined);
      const answer = await generator.suggestForDay({
        preferences,
        meal: { title: entry.title, time: entry.time, currentDish },
        goals,
        eaten,
        budget,
        otherMealsLeft,
        week,
        note: body.data.note,
      });
      const alternative: DayAlternative = {
        planIndex: entry.index,
        title: entry.title,
        time: entry.time,
        type: entry.type,
        description: answer.description,
        reason: answer.reason,
        budget,
        items: answer.foods.map((f) => ({
          name: f.name,
          quantity: f.quantity,
          unit: f.unit,
          nutrients: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber, sugar: f.sugar, addedSugar: Math.min(f.addedSugar, f.sugar) },
        })),
      };
      return alternative;
    } catch (error) {
      if (!(error instanceof RecognitionError)) throw error;
      request.log.warn({ reason: error.reason }, error.message);
      return failed(reply, error);
    }
  });
};
