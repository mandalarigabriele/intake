import { foodLine, isFixedMeal, mealFoodsText, mealTimes, mealTypeOf, planDay, type Meal, type PlannedEntry, type StoredPlan } from "@intake/shared";
import type { PlanLink, PlanSkip } from "../db/planStore.js";

/** A logged meal can cover a planned meal of the same type within this many minutes. */
const MATCH_WINDOW_MINUTES = 180;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export interface PlannedContext {
  date: string;
  /** Today in the Nutrition profile timezone. */
  today: string;
  /** Current local time HH:MM[:SS]. */
  now: string;
}

/**
 * Planned meals for a day that no logged meal covers.
 *
 * A planned meal is covered by:
 * 1. an explicit link (created by "Mangiato come previsto") to a meal that still exists, or
 * 2. a logged meal of the same type within ±3 hours (e.g. a breakfast logged through Claude),
 *    each logged meal covering at most one planned meal, nearest first.
 * Uncovered meals the owner skipped are returned with status "skipped", so they can be restored.
 */
export function plannedEntries(
  stored: StoredPlan | null,
  meals: Meal[],
  links: PlanLink[],
  context: PlannedContext,
  skips: PlanSkip[] = [],
): PlannedEntry[] {
  if (!stored) return [];
  const day = planDay(stored.plan, context.date);
  const times = mealTimes(day.meals);
  const mealIds = new Set(meals.map((meal) => meal.id));

  const covered = new Set<number>();
  const usedMeals = new Set<string>();
  for (const link of links) {
    if (link.planId === stored.id && mealIds.has(link.mealId)) {
      covered.add(link.index);
      usedMeals.add(link.mealId);
    }
  }

  // Candidate pairs (planned meal, logged meal) of the same type, closest first
  const pairs: Array<{ index: number; mealId: string; distance: number }> = [];
  day.meals.forEach((planned, index) => {
    if (covered.has(index)) return;
    const type = mealTypeOf(planned);
    for (const meal of meals) {
      if (usedMeals.has(meal.id) || meal.type !== type) continue;
      const distance = Math.abs(minutes(meal.time) - minutes(times[index]!));
      if (distance <= MATCH_WINDOW_MINUTES) pairs.push({ index, mealId: meal.id, distance });
    }
  });
  pairs.sort((a, b) => a.distance - b.distance);
  for (const pair of pairs) {
    if (covered.has(pair.index) || usedMeals.has(pair.mealId)) continue;
    covered.add(pair.index);
    usedMeals.add(pair.mealId);
  }

  const skipped = new Set(skips.filter((skip) => skip.planId === stored.id).map((skip) => skip.index));
  const nowHm = context.now.slice(0, 5);
  const entries: PlannedEntry[] = [];
  day.meals.forEach((planned, index) => {
    if (covered.has(index)) return;
    const time = times[index]!;
    const passed = context.date < context.today || (context.date === context.today && time <= nowHm);
    entries.push({
      planId: stored.id,
      index,
      title: planned.title,
      time,
      type: mealTypeOf(planned),
      foods: mealFoodsText(planned),
      lines: isFixedMeal(planned) ? planned.foods.map(foodLine) : [],
      status: !isFixedMeal(planned) ? "free" : skipped.has(index) ? "skipped" : passed ? "todo" : "planned",
      macros: isFixedMeal(planned) ? (planned.macros ?? null) : null,
    });
  });
  return entries.sort((a, b) => a.time.localeCompare(b.time) || a.index - b.index);
}
