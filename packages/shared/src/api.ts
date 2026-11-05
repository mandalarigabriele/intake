import type { MealPlan, MealTypeValue, PlannedMacros } from "./mealPlan.js";

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
