import type { Meal, MealItemInput, Nutrients, UpdateMealRequest } from "@intake/shared";
import type { MealWriteFields } from "../mcp/nutritionApi.js";

/** Nutrients → log_meal/update_meal item fields, leaving out the ones that were not measured. */
function nutrientFields(nutrients: Nutrients): Record<string, number> {
  const fields: Record<string, number | null> = {
    calories: nutrients.kcal,
    protein_g: nutrients.protein,
    carbs_g: nutrients.carbs,
    fat_g: nutrients.fat,
    saturated_fat_g: nutrients.saturatedFat,
    trans_fat_g: nutrients.transFat,
    fiber_g: nutrients.fiber,
    sugar_g: nutrients.sugar,
    added_sugar_g: nutrients.sugar === null ? null : nutrients.addedSugar,
    alcohol_g: nutrients.alcohol,
    caffeine_mg: nutrients.caffeineMg,
    sodium_mg: nutrients.sodiumMg,
  };
  return Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .map(([key, value]) => [key, Math.round(value * 100) / 100]),
  );
}

function itemFields(item: Pick<MealItemInput, "name" | "quantity" | "unit" | "nutrients">): Record<string, unknown> {
  return {
    name: item.name,
    ...(item.quantity !== null ? { amount: item.quantity } : {}),
    ...(item.unit ? { unit: item.unit } : {}),
    ...nutrientFields(item.nutrients),
  };
}

/** Fields to log a copy of an existing meal (same description, type, items or totals), stamped now. */
export function copyMealFields(meal: Meal): MealWriteFields & { description: string; meal_type: string } {
  const base = { description: meal.description, meal_type: meal.type || "snack" };
  if (meal.items.length > 0) return { ...base, items: meal.items.map(itemFields) };
  return { ...base, ...nutrientFields(meal.nutrients) };
}

/** update_meal fields from the edit form. */
export function updateMealFields(request: UpdateMealRequest): MealWriteFields {
  const fields: MealWriteFields = {
    description: request.description,
    meal_type: request.type,
    logged_at: `${request.date}T${request.time}`,
  };
  if (request.items && request.items.length > 0) {
    fields.items = request.items.map(itemFields);
  } else if (request.totals) {
    fields.calories = request.totals.kcal;
    fields.protein_g = request.totals.protein;
    fields.carbs_g = request.totals.carbs;
    fields.fat_g = request.totals.fat;
  }
  return fields;
}

/** Distinct recent meals (by description), newest first. */
export function recentDistinctMeals(meals: Meal[], limit: number): Meal[] {
  const seen = new Set<string>();
  const result: Meal[] = [];
  const sorted = [...meals].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  for (const meal of sorted) {
    const key = meal.description.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(meal);
    if (result.length >= limit) break;
  }
  return result;
}
