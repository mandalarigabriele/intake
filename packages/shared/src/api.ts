import type { MealPlan, MealTypeValue, PlannedMacros } from "./mealPlan.js";
import type { MealType, Nutrients } from "./nutrition.js";

/** A stored meal plan version. */
export interface StoredPlan {
  id: number;
  validFrom: string;
  /** ISO timestamp of the upload. */
  uploadedAt: string;
  plan: MealPlan;
}

export type PlanStatus = "active" | "scheduled" | "superseded";

export interface PlanVersion {
  id: number;
  validFrom: string;
  uploadedAt: string;
  status: PlanStatus;
}

export interface PlansResponse {
  /** The plan in effect today (in the Nutrition profile timezone), if any. */
  active: StoredPlan | null;
  /** Every uploaded version, newest validFrom first. */
  versions: PlanVersion[];
  today: string;
}

export interface PlanUploadError {
  error: "invalid_plan";
  issues: Array<{ path: string; message: string }>;
}

/**
 * A planned meal as shown in the day timeline.
 * - "todo": its time has passed and no logged meal covers it ("Da registrare")
 * - "planned": still to come ("Dal piano")
 * - "free": a free slot from the plan ("Libero")
 */
export type PlannedStatus = "todo" | "planned" | "free";

export interface PlannedEntry {
  planId: number;
  /** Position of the meal in the plan day, used to log it. */
  index: number;
  title: string;
  /** HH:MM, planned or default slot. */
  time: string;
  type: MealTypeValue;
  foods: string;
  status: PlannedStatus;
  macros: PlannedMacros | null;
}

/** A meal ingredient as sent back when editing (nutrients already scaled to the quantity). */
export interface MealItemInput {
  name: string;
  quantity: number | null;
  unit: string | null;
  nutrients: Nutrients;
}

export interface UpdateMealRequest {
  /** Local date and time of the meal. */
  date: string;
  time: string;
  type: MealType;
  description: string;
  /** Full ingredient list (replaces the existing one); totals are then the sum of the items. */
  items?: MealItemInput[];
  /** Totals for a meal without items. */
  totals?: { kcal: number; protein: number; carbs: number; fat: number };
}

export interface RepeatMealRequest {
  /** Date of the meal to copy, to find it. */
  date: string;
  idempotencyKey: string;
}

export interface FavoriteMealRequest {
  name: string;
}

export interface WeekDay {
  date: string;
  /** null when nothing was logged that day. */
  kcal: number | null;
  protein: number | null;
  mealCount: number;
}

export interface WeightEntry {
  date: string;
  weight: number;
}

export interface WeekView {
  /** Monday and Sunday of the week. */
  start: string;
  end: string;
  today: string;
  goals: { kcal: number | null; protein: number | null };
  days: WeekDay[];
  /** Averages over the days with meals; null when none. */
  averages: { kcal: number; protein: number; days: number } | null;
  weight: {
    unit: string;
    target: number | null;
    /** Daily weigh-ins over the last 90 days up to the end of the week, oldest first. */
    entries: WeightEntry[];
  };
}

export interface LogWeightRequest {
  weightKg: number;
  idempotencyKey: string;
}
