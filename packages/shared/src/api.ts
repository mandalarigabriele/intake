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

/** kcal and protein of a planned or logged meal. */
export interface KcalProtein {
  kcal: number;
  protein: number;
}

/** One planned meal of the day, next to the logged meal that covers it. */
export interface ComparedMeal {
  title: string;
  /** HH:MM, planned or default slot. */
  time: string;
  /** "eaten": covered by a logged meal; "free": a free meal (logged may still be set). */
  status: "eaten" | "skipped" | "todo" | "planned" | "free";
  /** null for free meals and meals without macros in the plan. */
  planned: KcalProtein | null;
  /** The covering logged meal; null when nothing covers it. */
  logged: KcalProtein | null;
}

/** "Piano e realtà": the day's plan against what was logged. */
export interface PlanComparison {
  meals: ComparedMeal[];
  /** Meals logged that cover no planned meal. */
  extras: KcalProtein & { count: number };
  /** Sum of the planned meals with macros; null when none has them. */
  plannedDay: KcalProtein | null;
  hasFreeMeal: boolean;
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

/** Averages over the completed logged days of the week (today excluded). */
export interface WeekAverages {
  kcal: number;
  protein: number;
  /** null when no completed day recorded fiber. */
  fiber: number | null;
  waterMl: number;
  days: number;
  /** Share of the macro calories (protein and carbs 4 kcal/g, fat 9 kcal/g), whole percentages adding up to 100; null without macros. */
  kcalShare: { protein: number; carbs: number; fat: number } | null;
}

export interface WeightEntry {
  date: string;
  weight: number;
}

/** A planned meal whose logged meal differed from the plan. */
export interface MealDeviation {
  date: string;
  title: string;
  time: string;
  planned: number;
  logged: number;
}

/** "Piano e realtà" over a week: completed days with a plan, and the largest deviations. */
export interface WeekPlanComparison {
  /** Completed days (today excluded) with a plan in effect and meals logged. */
  days: Array<{ date: string; planned: number; eaten: number; hasFreeMeal: boolean }>;
  /** Average eaten − planned kcal over those days without free meals; null when none. */
  averageDiff: number | null;
  /** Up to 3 planned meals with the largest kcal difference from the plan (today included). */
  deviations: MealDeviation[];
}

export interface WeekView {
  /** Monday and Sunday of the week. */
  start: string;
  end: string;
  today: string;
  goals: { kcal: number | null; protein: number | null; fiber: number | null; waterMl: number | null };
  days: WeekDay[];
  /** null when no completed day of the week has meals. */
  averages: WeekAverages | null;
  consistency: WeekConsistency;
  /** null when no plan with macros was in effect during the week. */
  plan: WeekPlanComparison | null;
}

/** Profilo (docs/design Profilo): weigh-ins and daily goals from Nutrition, plus which integrations are set up. */
export interface ProfileView {
  today: string;
  weight: {
    unit: string;
    target: number | null;
    /** Daily weigh-ins over the last 90 days, oldest first. */
    entries: WeightEntry[];
  };
  goals: {
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    waterMl: number | null;
  };
  /** HEVY_API_KEY is set on the server. */
  hevyConfigured: boolean;
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
  /** Days of the week up to today with meals, out of the days so far (today included). */
  logged: { days: string[]; total: number };
  protein: TargetDays;
  fiber: TargetDays;
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

/** One exercise of a Hevy workout, summarized. */
export interface WorkoutExercise {
  title: string;
  /** Sets that are not warm-ups. */
  workingSets: number;
  /** Heaviest working set (weight and its reps); null for bodyweight or timed exercises. */
  best: { weightKg: number; reps: number | null } | null;
  /** Total seconds of timed sets (planks, cardio); 0 when none. */
  durationSeconds: number;
}

/** One minute of heart rate during a workout, counted from the workout start. */
export interface WorkoutHeartRatePoint {
  minute: number;
  bpm: number;
}

/**
 * A workout of the day: from Hevy (read live, possibly enriched with heart rate and kcal from Apple Health)
 * or from Apple Health only (duplicates already merged, docs/apple-health.md).
 */
export interface Workout {
  id: string;
  /** "hevy" when the workout comes from the Hevy API, "health" when only Apple Health has it. */
  origin: "hevy" | "health";
  title: string;
  /** Type label ("Forza", "Cyclette") and family used for the icon ("Forza", "Ciclismo", "Calcio", ...). */
  type: string;
  family: string;
  /** Local date and times (YYYY-MM-DD, HH:MM). */
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  /** Hevy only: exercises, working sets and volume (empty / 0 for Health workouts). */
  exercises: WorkoutExercise[];
  /** Working sets in the whole workout. */
  sets: number;
  /** Sum of weight × reps over the working sets, in kg. */
  volumeKg: number;
  /** Label of the source shown on the card ("Hevy", "MERACH", "Fitbit"). */
  source: string;
  kcal: number | null;
  distanceKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  /** Heart rate recorded during the workout, one point per minute (empty when none). */
  heartRate: WorkoutHeartRatePoint[];
  /** Every source of the session and whether its data was used (false = duplicate discarded). */
  sources: Array<{ label: string; used: boolean }>;
  /** Source label that gave the heart rate, null when none. */
  heartRateFrom: string | null;
  /** Source label that gave the kcal, null when none. */
  kcalFrom: string | null;
}

export interface WorkoutsResponse {
  /** false when no Hevy API key is configured on the server. */
  configured: boolean;
  /** true when Hevy did not answer: only Apple Health workouts are listed. */
  hevyUnavailable?: boolean;
  workouts: Workout[];
}

// ---------------------------------------------------------------------------
// Apple Health (Health Auto Export) — see docs/apple-health.md

/** Metrics shown in the import preview. */
export type HealthPreviewMetric = "steps" | "distanceKm" | "sleep" | "restingHr" | "activeKcal" | "restingKcal";

/** Groups of exported data that Intake does not import, for the "Ignorati" list. */
export type HealthIgnoredGroup = "nutrition" | "weight" | "private" | "detail" | "vitals" | "vo2max" | "gait" | "other";

/** A group of records of the same session merged into one workout. Times are local HH:MM. */
export interface HealthDuplicate {
  date: string;
  /** Label of the merged session (Forza, Cyclette, ...). */
  label: string;
  start: string;
  end: string;
  records: Array<{ source: string; label: string; start: string; end: string }>;
  /** Source whose record gave the title. */
  kept: string;
  /** Source that gave the heart rate, when it differs from `kept`. */
  heartRateFrom: string | null;
  /** True when pieces of the same source were joined. */
  joined: boolean;
  /** True when the records had different names (e.g. Cyclette and Ciclismo). */
  renamed: boolean;
  discarded: number;
}

export interface HealthImportPreview {
  firstDate: string | null;
  lastDate: string | null;
  days: number;
  newDays: number;
  updatedDays: number;
  metrics: Array<{
    metric: HealthPreviewMetric;
    days: number;
    /** Irregular data: null when regular; `since` is the last regular day when known. */
    irregular: { since: string | null } | null;
  }>;
  workouts: {
    found: number;
    discarded: number;
    sessions: number;
    byFamily: Array<{ family: string; count: number }>;
    duplicates: HealthDuplicate[];
  };
  ignored: HealthIgnoredGroup[];
}

export interface HealthImportResult {
  preview: HealthImportPreview;
}

/** Error codes of POST /api/health/import. */
export type HealthImportErrorCode = "not_health_export" | "no_data";

export type HealthCoverageMetric = "steps" | "sleep" | "restingHr" | "activeKcal" | "workouts";

export interface HealthStatus {
  today: string;
  lastImport: { receivedAt: string; kind: "file" | "sync" } | null;
  firstDate: string | null;
  lastDate: string | null;
  days: number;
  workouts: number;
  /** One character per day from `from` to `to`: "p" present, "i" present but irregular, "m" missing. */
  coverage: { from: string; to: string; rows: Array<{ metric: HealthCoverageMetric; cells: string }> } | null;
  /** Source labels seen in the data (Fitbit, MERACH, ...). */
  sources: string[];
  /** Active energy stopped arriving regularly while other data keeps coming. */
  activeEnergyWarning: { since: string | null; presentDays: number; totalDays: number } | null;
  settings: HealthSettings;
}

export interface HealthSettings {
  stepGoal: number;
}

/** One night for the Today card and the Timeline sleep chip. Times are local HH:MM. */
export interface HealthNight {
  date: string;
  bedtime: string;
  wake: string;
  asleepMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  coreMinutes: number;
  awakeMinutes: number;
}

/** Apple Health values of one day ("Attività e riposo"). Series end on `date`, oldest first; null = no data. */
export interface HealthDay {
  date: string;
  today: string;
  /** False when nothing was ever imported: the card is hidden. */
  connected: boolean;
  steps: number | null;
  distanceKm: number | null;
  /** Average of the 7 days before `date` that have steps. */
  stepsAverage: number | null;
  stepsSeries: Array<{ date: string; value: number | null }>;
  sleep: HealthNight | null;
  sleepSeries: Array<{ date: string; minutes: number | null }>;
  restingHr: number | null;
  /** Average of the 7 days before the last 7 (the week before). */
  restingHrLastWeek: number | null;
  restingHrSeries: Array<{ date: string; value: number | null }>;
  /** Label of the app that wrote the night (or most data), e.g. "Fitbit". */
  source: string | null;
  lastImportAt: string | null;
  /** Latest day with any Health data. */
  lastDataDate: string | null;
}

/** One night on the Andamento › Salute sleep chart: minutes from midnight of the wake-up day (negative = the evening before). */
export interface HealthTrendNight {
  start: number;
  end: number;
  asleep: number;
  deep: number;
  rem: number;
  core: number;
  awake: number;
}

export interface HealthTrendDay {
  date: string;
  steps: number | null;
  distanceKm: number | null;
  restingHr: number | null;
  sleep: HealthTrendNight | null;
}

/** Andamento › Salute (docs/apple-health.md): the last 7, 30 or 90 days of Apple Health data, from SQLite only. */
export interface HealthTrends {
  today: string;
  from: string;
  period: 7 | 30 | 90;
  /** First day with any Health data, for "dati disponibili dall'8 settembre". */
  firstDataDate: string | null;
  stepGoal: number;
  /** Source label of the latest night (Fitbit, ...), shown as a pill. */
  source: string | null;
  /** Oldest first, one entry per day of the period, today included. */
  days: HealthTrendDay[];
  sleep: {
    nights: number;
    averageAsleep: number;
    /** Mean sleep start and wake time in minutes from midnight, averaged across midnight. */
    averageStart: number;
    averageEnd: number;
    shortest: { date: string; minutes: number };
    longest: { date: string; minutes: number };
    phases: { deep: number; rem: number; core: number; awake: number };
    under7h: number;
    afterMidnight: number;
  } | null;
  /** Finished days only: today is drawn light and left out. */
  steps: { days: number; average: number; atGoal: number; best: { date: string; steps: number } } | null;
  heart: { days: number; average: number; min: { date: string; value: number }; previousAverage: number | null } | null;
}
