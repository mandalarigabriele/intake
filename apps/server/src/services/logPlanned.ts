import { isFixedMeal, mealFoodsText, mealTimes, mealTypeOf, planDay, type PlannedMacros } from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { MealWriteFields, NutritionApi } from "../mcp/nutritionApi.js";

export class PlanMealNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanMealNotFoundError";
  }
}

/** The planned meal has no nutrients, so logging it would store a meal without values. */
export class PlanMealWithoutMacrosError extends Error {
  constructor() {
    super("The planned meal has no nutrients to log");
    this.name = "PlanMealWithoutMacrosError";
  }
}

/** Planned nutrients → log_meal fields (optional ones only when the plan has them). */
export function macrosToFields(macros: PlannedMacros): MealWriteFields {
  const fields: MealWriteFields = {
    calories: macros.kcal,
    protein_g: macros.protein,
    carbs_g: macros.carbs,
    fat_g: macros.fat,
    fiber_g: macros.fiber,
  };
  if (macros.sugar !== undefined) fields.sugar_g = macros.sugar;
  if (macros.addedSugar !== undefined) fields.added_sugar_g = macros.addedSugar;
  if (macros.saturatedFat !== undefined) fields.saturated_fat_g = macros.saturatedFat;
  if (macros.sodiumMg !== undefined) fields.sodium_mg = macros.sodiumMg;
  if (macros.caffeineMg !== undefined) fields.caffeine_mg = macros.caffeineMg;
  return fields;
}

export interface LogPlannedInput {
  date: string;
  planId: number;
  index: number;
  today: string;
  now: string;
}

/**
 * "Mangiato come previsto": logs a planned meal with its full planned nutrients and links it.
 * Past meals are logged at their planned time; the idempotency key makes a double tap safe.
 */
export async function logPlannedMeal(
  api: Pick<NutritionApi, "logMeal" | "mealsByDate">,
  plans: Pick<PlanStore, "get" | "addLink">,
  input: LogPlannedInput,
): Promise<{ mealId: string | null }> {
  const stored = plans.get(input.planId);
  if (!stored) throw new PlanMealNotFoundError("Plan not found");
  const day = planDay(stored.plan, input.date);
  const meal = day.meals[input.index];
  if (!meal || !isFixedMeal(meal)) throw new PlanMealNotFoundError("Planned meal not found");
  if (!meal.macros) throw new PlanMealWithoutMacrosError();

  const time = mealTimes(day.meals)[input.index]!;
  const isPast = input.date < input.today || (input.date === input.today && time <= input.now.slice(0, 5));
  const description = `${meal.title}: ${mealFoodsText(meal)}`;

  const { id } = await api.logMeal({
    description,
    meal_type: mealTypeOf(meal),
    ...macrosToFields(meal.macros),
    ...(isPast ? { logged_at: `${input.date}T${time}` } : {}),
    idempotency_key: `intake-plan-${stored.id}-${input.date}-${input.index}`,
  });

  // The response text usually carries the new id; otherwise find the meal we just logged
  let mealId = id;
  if (!mealId) {
    const { meals } = await api.mealsByDate(input.date);
    mealId = meals.find((m) => m.description === description && (!isPast || m.time === time))?.id ?? null;
  }
  if (mealId) plans.addLink(input.date, stored.id, input.index, mealId);
  return { mealId };
}
