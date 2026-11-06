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
 * - "skipped": the owner chose to skip it ("Saltato"); it can be restored
 */
export type PlannedStatus = "todo" | "planned" | "free" | "skipped";

export interface PlannedEntry {
  planId: number;
  /** Position of the meal in the plan day, used to log it. */
  index: number;
  title: string;
  /** HH:MM, planned or default slot. */
  time: string;
  type: MealTypeValue;
  foods: string;
  /** One line per planned food ("Mandorle 25 g"); empty for free meals. */
  lines: string[];
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
  /** Averages over the completed days (today excluded) with meals; null when none. */
  averages: { kcal: number; protein: number; days: number } | null;
  consistency: WeekConsistency;
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

/** The "Dai tuoi dati" card on Oggi: one sentence from the owner's own data, or null when there is too little. */
export interface InsightResponse {
  insight: { text: string; window: string } | null;
}

export interface TargetDays {
  /** Completed logged days of the week at or above the goal. */
  hit: number;
  /** Completed logged days of the week (today counts once it is over). */
  total: number;
  /** Best completed day, for the note ("giovedì 122 g"). */
  best: { date: string; value: number } | null;
  goal: number | null;
}

/** "Costanza" card on Settimana (docs/design/DESIGN.md). */
export interface WeekConsistency {
  /** Consecutive logged days up to today (today included once it has meals), oldest first. */
  streak: string[];
  protein: TargetDays;
  water: TargetDays;
  /** Planned meals logged with "Mangiato come previsto" this week. */
  asPlanned: number;
  /** Planned meals skipped this week. */
  skipped: number;
}

/** Which reminders are sent (Web Push, to the installed app). */
export interface ReminderSettings {
  /** At the planned time of a meal that is not logged or skipped. */
  meal: boolean;
  /** 45 minutes later, if the planned meal is still not logged. */
  todo: boolean;
  /** At 16:00 and 20:00, when water is behind the goal for that time of day. */
  water: boolean;
  /** At 21:30: kcal and protein of the day against the goals. */
  summary: boolean;
}

export interface PushStatus {
  /** VAPID public key (base64url) for PushManager.subscribe. */
  publicKey: string;
  /** Devices subscribed. */
  devices: number;
  settings: ReminderSettings;
}

export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
