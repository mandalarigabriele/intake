import { WEEKDAYS, type FixedPlannedMeal, type MealPlan, type MealTypeValue, type PlannedDay, type PlannedFood, type PlannedMeal, type Weekday } from "./mealPlan.js";

/** Weekday of a YYYY-MM-DD date (calendar arithmetic, no timezone involved). */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(day + 6) % 7]!;
}

export function planDay(plan: MealPlan, date: string): PlannedDay {
  return plan.days[weekdayOf(date)];
}

export function isFixedMeal(meal: PlannedMeal): meal is FixedPlannedMeal {
  return meal.free !== true;
}

const TITLE_TYPES: Array<[RegExp, MealTypeValue]> = [
  [/colazione|breakfast/i, "breakfast"],
  [/pranzo|lunch/i, "lunch"],
  [/cena|dinner/i, "dinner"],
  [/spuntino|merenda|snack/i, "snack"],
];

/** Meal type from the plan, or inferred from the title ("Spuntino dolce" → snack), or from the time. */
export function mealTypeOf(meal: PlannedMeal): MealTypeValue {
  if (meal.type) return meal.type;
  for (const [pattern, type] of TITLE_TYPES) if (pattern.test(meal.title)) return type;
  if (meal.time) {
    if (meal.time < "10:30") return "breakfast";
    if (meal.time >= "12:00" && meal.time < "15:00") return "lunch";
    if (meal.time >= "19:00") return "dinner";
  }
  return "snack";
}

/** Default slots for planned meals without a time (docs/design/DESIGN.md). */
const DEFAULT_TIMES: Record<Exclude<MealTypeValue, "snack">, string> = {
  breakfast: "08:00",
  lunch: "13:00",
  dinner: "20:00",
};

/** Time of each meal of a day: the planned one, or a default slot (snacks: 11:00 before lunch, 16:00 after). */
export function mealTimes(meals: PlannedMeal[]): string[] {
  const firstLunch = meals.findIndex((meal) => mealTypeOf(meal) === "lunch");
  return meals.map((meal, index) => {
    if (meal.time) return meal.time;
    const type = mealTypeOf(meal);
    if (type !== "snack") return DEFAULT_TIMES[type];
    return firstLunch !== -1 && index > firstLunch ? "16:00" : "11:00";
  });
}

const decimal = (value: number) => String(value).replace(".", ",");

/** "Pasta 120 g (a crudo)", or just the name for free-text lines. */
export function foodLine(food: PlannedFood): string {
  const amount = food.quantity === undefined ? "" : ` ${decimal(food.quantity)}${food.unit ? ` ${food.unit}` : ""}`;
  return `${food.name}${amount}${food.note ? ` (${food.note})` : ""}`;
}

/** One-line summary of a planned meal: its description, or "Pasta 100 g + Insalata". */
export function mealFoodsText(meal: PlannedMeal): string {
  if (meal.description) return meal.description;
  return isFixedMeal(meal) ? meal.foods.map(foodLine).join(" + ") : "";
}

export interface PlanDayTotals {
  /** Sum of the planned meals' kcal; null when no meal has nutrients. */
  kcal: number | null;
  /** Sum of the planned meals' protein, or the day's expected protein. */
  protein: number | null;
  /** True when at least one meal of the day is "free", so the totals are partial. */
  hasFreeMeal: boolean;
}

export function dayTotals(day: PlannedDay): PlanDayTotals {
  let kcal = 0;
  let protein = 0;
  let withMacros = 0;
  let hasFreeMeal = false;
  for (const meal of day.meals) {
    if (!isFixedMeal(meal)) hasFreeMeal = true;
    else if (meal.macros) {
      kcal += meal.macros.kcal;
      protein += meal.macros.protein;
      withMacros += 1;
    }
  }
  return {
    kcal: withMacros > 0 ? kcal : null,
    protein: day.expectedProtein ?? (withMacros > 0 ? protein : null),
    hasFreeMeal,
  };
}

/** Average daily kcal and protein over the fully planned days (days with a free meal are skipped). */
export function planAverages(plan: MealPlan): { kcal: number | null; protein: number | null } | null {
  const totals = WEEKDAYS.map((weekday) => dayTotals(plan.days[weekday])).filter((t) => !t.hasFreeMeal);
  const average = (values: Array<number | null>) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((sum, v) => sum + v, 0) / known.length : null;
  };
  const kcal = average(totals.map((t) => t.kcal));
  const protein = average(totals.map((t) => t.protein));
  return kcal === null && protein === null ? null : { kcal, protein };
}
