import type { PlanComparison, PlannedEntry } from "./api.js";

/**
 * Nutrition data as Intake uses it, independent of how the Nutrition MCP server formats it.
 *
 * `null` means "not measured / not recorded", which is different from 0.
 */

export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  saturatedFat: number | null;
  transFat: number | null;
  fiber: number | null;
  sugar: number | null;
  addedSugar: number | null;
  alcohol: number | null;
  caffeineMg: number | null;
  sodiumMg: number | null;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealItem {
  name: string;
  /** Quantity exactly as the server returned it, e.g. "150 g" or "2 cucchiaini". */
  quantityText: string;
  quantity: number | null;
  unit: string | null;
  nutrients: Nutrients;
}

export interface Meal {
  id: string;
  /** Local date in the Nutrition profile's timezone, YYYY-MM-DD. */
  date: string;
  /** Local time in the Nutrition profile's timezone, HH:MM. */
  time: string;
  /** Usually a MealType; kept as a string so an unexpected value does not break parsing. */
  type: MealType | (string & {});
  description: string;
  notes: string | null;
  nutrients: Nutrients;
  /** Empty when the meal was logged without a list of foods. */
  items: MealItem[];
}

export interface NutritionGoals {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
  /** Upper limits; null when not set. */
  limits: {
    saturatedFat: number | null;
    sugar: number | null;
    addedSugar: number | null;
    alcohol: number | null;
    caffeineMg: number | null;
    sodiumMg: number | null;
  };
  targetWeight: { value: number; unit: "kg" | "lb" } | null;
}

export interface ClockInfo {
  /** IANA timezone of the Nutrition profile, e.g. "Europe/Rome". */
  timezone: string;
  /** Local date, YYYY-MM-DD. */
  localDate: string;
  /** Local time, HH:MM:SS. */
  localTime: string;
  /** Current instant, ISO 8601 in UTC. */
  utc: string;
}

/** Daily targets used by the Today view; null when the goal is not set. */
export interface DayGoals {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
}

export interface DayTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
}

/** Everything the Today view shows for one date. */
export interface DayView {
  /** The requested date, YYYY-MM-DD in the Nutrition profile's timezone. */
  date: string;
  isToday: boolean;
  clock: ClockInfo;
  goals: DayGoals;
  totals: DayTotals;
  meals: Meal[];
  /** Planned meals from the active plan that no logged meal covers, sorted by time. */
  planned: PlannedEntry[];
  /** Whether a meal plan is in effect on this date. */
  hasPlan: boolean;
  /** Plan against logged meals; null without a plan in effect. */
  comparison: PlanComparison | null;
}

export interface AddWaterRequest {
  amountMl: number;
  /** Unique per tap, so a retried request does not log the water twice. */
  idempotencyKey: string;
}
