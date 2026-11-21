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

export function itemFields(item: Pick<MealItemInput, "name" | "quantity" | "unit" | "nutrients">): Record<string, unknown> {
  return {
    name: item.name,
    ...(item.quantity !== null ? { amount: item.quantity } : {}),
    ...(item.unit ? { unit: item.unit } : {}),
    ...nutrientFields(item.nutrients),
  };
}

/**
 * Item keys Nutrition accepts only on every item of a meal or on none: a list that gives them on some items only is
 * refused, and so is sugar without added sugar.
 */
const ALL_OR_NONE = ["saturated_fat_g", "sodium_mg", "fiber_g", "sugar_g", "added_sugar_g"];

/** Drops an all-or-none key from every item when any item lacks it, so log_meal and update_meal never refuse the list. */
export function itemsAllOrNone(items: Record<string, unknown>[]): Record<string, unknown>[] {
  // A key on some items only; a key no item has is already "none"
  const drop = ALL_OR_NONE.filter((key) => items.some((item) => key in item) && items.some((item) => !(key in item)));
  // Sugar and added sugar go together: Nutrition refuses sugar without added sugar (e.g. meals logged before it was tracked)
  if (drop.includes("sugar_g") && !drop.includes("added_sugar_g") && items.some((item) => "added_sugar_g" in item)) drop.push("added_sugar_g");
  if (drop.includes("added_sugar_g") && !drop.includes("sugar_g") && items.some((item) => "sugar_g" in item)) drop.push("sugar_g");
  if (drop.length === 0) return items;
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !drop.includes(key))));
}

/** Fields to log a copy of an existing meal (same description, type, items or totals), stamped now. */
export function copyMealFields(meal: Meal): MealWriteFields & { description: string; meal_type: string } {
  const base = { description: meal.description, meal_type: meal.type || "snack" };
  if (meal.items.length > 0) return { ...base, items: itemsAllOrNone(meal.items.map(itemFields)) };
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
    fields.items = itemsAllOrNone(request.items.map(itemFields));
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
