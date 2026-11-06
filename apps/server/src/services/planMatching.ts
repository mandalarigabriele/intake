import {
  foodLine,
  isFixedMeal,
  mealFoodsText,
  mealTimes,
  mealTypeOf,
  planDay,
  type ComparedMeal,
  type Meal,
  type PlanComparison,
  type PlannedEntry,
  type StoredPlan,
} from "@intake/shared";
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
 * Which logged meal covers each planned meal of the day (planned index → meal id).
 *
 * A planned meal is covered by:
 * 1. an explicit link (created by "Mangiato come previsto") to a meal that still exists, or
 * 2. a logged meal of the same type within ±3 hours (e.g. a breakfast logged through Claude),
 *    each logged meal covering at most one planned meal, nearest first.
 */
function coverage(stored: StoredPlan, meals: Meal[], links: PlanLink[], date: string): Map<number, string> {
  const day = planDay(stored.plan, date);
  const times = mealTimes(day.meals);
  const mealIds = new Set(meals.map((meal) => meal.id));

  const covered = new Map<number, string>();
  const usedMeals = new Set<string>();
  for (const link of links) {
    if (link.planId === stored.id && mealIds.has(link.mealId) && !usedMeals.has(link.mealId)) {
      covered.set(link.index, link.mealId);
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
    covered.set(pair.index, pair.mealId);
    usedMeals.add(pair.mealId);
  }
  return covered;
}

const isPassed = (context: PlannedContext, time: string) =>
  context.date < context.today || (context.date === context.today && time <= context.now.slice(0, 5));

/**
 * Planned meals for a day that no logged meal covers (see coverage()).
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
  const covered = coverage(stored, meals, links, context.date);

  const skipped = new Set(skips.filter((skip) => skip.planId === stored.id).map((skip) => skip.index));
  const entries: PlannedEntry[] = [];
  day.meals.forEach((planned, index) => {
    if (covered.has(index)) return;
    const time = times[index]!;
    const passed = isPassed(context, time);
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

/**
 * Plan against what was logged, meal by meal: planned kcal and protein next to the logged meal
 * covering each planned meal, plus the meals logged outside the plan. Null without a plan.
 */
export function planComparison(
  stored: StoredPlan | null,
  meals: Meal[],
  links: PlanLink[],
  context: PlannedContext,
  skips: PlanSkip[] = [],
): PlanComparison | null {
  if (!stored) return null;
  const day = planDay(stored.plan, context.date);
  const times = mealTimes(day.meals);
  const covered = coverage(stored, meals, links, context.date);
  const skipped = new Set(skips.filter((skip) => skip.planId === stored.id).map((skip) => skip.index));
  const byId = new Map(meals.map((meal) => [meal.id, meal]));

  const compared: ComparedMeal[] = day.meals.map((planned, index) => {
    const time = times[index]!;
    const meal = covered.has(index) ? byId.get(covered.get(index)!) : undefined;
    const macros = isFixedMeal(planned) ? planned.macros : undefined;
    const status: ComparedMeal["status"] = !isFixedMeal(planned)
      ? "free"
      : meal
        ? "eaten"
        : skipped.has(index)
          ? "skipped"
          : isPassed(context, time)
            ? "todo"
            : "planned";
    return {
      title: planned.title,
      time,
      status,
      planned: macros ? { kcal: macros.kcal, protein: macros.protein } : null,
      logged: meal ? { kcal: meal.nutrients.kcal, protein: meal.nutrients.protein } : null,
    };
  });
  compared.sort((a, b) => a.time.localeCompare(b.time));

  const used = new Set(covered.values());
  const extras = meals.filter((meal) => !used.has(meal.id));
  const withMacros = compared.filter((m) => m.planned);
  return {
    meals: compared,
    extras: {
      count: extras.length,
      kcal: extras.reduce((sum, m) => sum + m.nutrients.kcal, 0),
      protein: extras.reduce((sum, m) => sum + m.nutrients.protein, 0),
    },
    plannedDay:
      withMacros.length > 0
        ? { kcal: withMacros.reduce((sum, m) => sum + m.planned!.kcal, 0), protein: withMacros.reduce((sum, m) => sum + m.planned!.protein, 0) }
        : null,
    hasFreeMeal: compared.some((m) => m.status === "free"),
  };
}
