/**
 * "Genera con l'IA" (Piano): the preferences of a generated meal plan, the shape the AI answers in, its conversion
 * to Intake's MealPlan and the checks run on it (day totals against the goals, the constraints). Plain functions, no
 * AI here: the server calls the model and runs these checks on every answer. Rules in docs/plan-generation.md.
 */
import { z } from "zod";
import { MEAL_PLAN_SCHEMA_VERSION, MEAL_TYPES, WEEKDAYS, mealPlanSchema, type MealPlan, type PlannedMeal, type Weekday } from "./mealPlan.js";

export const PLAN_DIETS = ["omnivore", "vegetarian", "pescatarian", "vegan"] as const;
export type PlanDiet = (typeof PLAN_DIETS)[number];

/** Models offered for generating plans (Impostazioni › Funzioni): a plan needs more care than a photo. */
export const PLAN_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_PLAN_MODEL = "claude-sonnet-5-5";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const planSlotSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,24}$/),
    label: z.string().trim().min(1).max(30),
    time,
    type: z.enum(MEAL_TYPES),
  })
  .strict();
export type PlanSlot = z.infer<typeof planSlotSchema>;

/** Text list typed by the user ("funghi, salmone"): trimmed, without empty or repeated entries. */
const terms = z
  .array(z.string().trim().min(1).max(40))
  .max(30)
  .transform((list) => [...new Set(list.map((term) => term.toLowerCase()))]);

export const planPreferencesSchema = z
  .object({
    /** The meals of the day in order, with their time and type. */
    slots: z.array(planSlotSchema).min(1).max(7),
    /** Free meals ("Libero"): no foods planned, e.g. Saturday dinner. */
    freeMeals: z.array(z.object({ day: z.enum(WEEKDAYS), slot: z.string() }).strict()).max(14),
    /** The same meal at most this many times a week (breakfast excepted when sameBreakfastOk). */
    maxSameMealPerWeek: z.number().int().min(1).max(7),
    /** Never the same dish twice on one day. */
    noRepeatSameDay: z.boolean(),
    /** The same breakfast every day is fine. */
    sameBreakfastOk: z.boolean(),
    diet: z.enum(PLAN_DIETS),
    /** Hard constraint: never in the plan. */
    allergies: terms,
    /** Avoided. */
    dislikes: terms,
    /** Most minutes of cooking for one weekday meal; null when it doesn't matter. */
    cookingMinutes: z.number().int().min(5).max(120).nullable(),
    /** Lunch can be the leftovers of the dinner before. */
    leftovers: z.boolean(),
    /** Seasonal produce. */
    seasonal: z.boolean(),
    /** Also send the descriptions of the meals of the last 14 days, so the plan is close to the habits. */
    learnFromMeals: z.boolean(),
    notes: z.string().trim().max(1000),
  })
  .strict();
export type PlanPreferences = z.infer<typeof planPreferencesSchema>;

export const DEFAULT_PLAN_SLOTS: PlanSlot[] = [
  { id: "breakfast", label: "Colazione", time: "07:30", type: "breakfast" },
  { id: "snack-am", label: "Spuntino", time: "10:30", type: "snack" },
  { id: "lunch", label: "Pranzo", time: "13:00", type: "lunch" },
  { id: "snack-pm", label: "Spuntino", time: "16:30", type: "snack" },
  { id: "dinner", label: "Cena", time: "20:00", type: "dinner" },
];

export function defaultPlanPreferences(slots: PlanSlot[] = DEFAULT_PLAN_SLOTS): PlanPreferences {
  return {
    slots,
    freeMeals: [],
    maxSameMealPerWeek: 2,
    noRepeatSameDay: true,
    sameBreakfastOk: true,
    diet: "omnivore",
    allergies: [],
    dislikes: [],
    cookingMinutes: 30,
    leftovers: true,
    seasonal: true,
    learnFromMeals: false,
    notes: "",
  };
}

/** The slots of an existing plan (its Monday), so a new plan keeps the same meals and times. */
export function slotsFromPlan(plan: MealPlan | null | undefined): PlanSlot[] | null {
  const meals = plan?.days.monday.meals ?? [];
  if (meals.length === 0) return null;
  const slots = meals.slice(0, 7).map((meal, i): PlanSlot => {
    const type = meal.type ?? DEFAULT_PLAN_SLOTS.find((s) => meal.title.toLowerCase().includes(s.label.toLowerCase()))?.type ?? "snack";
    return { id: `slot-${i + 1}`, label: meal.title.slice(0, 30), time: meal.time ?? DEFAULT_PLAN_SLOTS.find((s) => s.type === type)!.time, type };
  });
  return slots;
}

/** Daily targets the plan aims at (the active goals in Nutrition). */
export interface PlanTargets {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

// ── The AI answer ─────────────────────────────────────────

const macrosAnswer = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  sugar: z.number().nonnegative(),
  addedSugar: z.number().nonnegative(),
});

export const generatedPlanSchema = z.object({
  notes: z.array(z.string().trim().min(1).max(200)).max(6),
  days: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        note: z.string().max(80),
        meals: z.array(
          z.object({
            slot: z.string(),
            free: z.boolean(),
            description: z.string().max(160),
            foods: z.array(z.object({ name: z.string().trim().min(1).max(80), quantity: z.number().positive(), unit: z.string().trim().min(1).max(12) })).max(12),
            macros: macrosAnswer,
          }),
        ),
      }),
    )
    .length(7),
});
export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

const macrosJson = {
  type: "object",
  additionalProperties: false,
  required: ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"],
  properties: {
    kcal: { type: "number" },
    protein: { type: "number", description: "grams" },
    carbs: { type: "number", description: "grams" },
    fat: { type: "number", description: "grams" },
    fiber: { type: "number", description: "grams" },
    sugar: { type: "number", description: "total sugars, grams" },
    addedSugar: { type: "number", description: "added sugars, grams, part of sugar" },
  },
} as const;

/** JSON schema of the AI answer (structured output: every object closed, every field required). */
export const GENERATED_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes", "days"],
  properties: {
    notes: { type: "array", items: { type: "string" }, description: "Up to 6 short general notes for the week (shopping, batch cooking)" },
    days: {
      type: "array",
      description: "Exactly the seven days, monday to sunday",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "note", "meals"],
        properties: {
          day: { type: "string", enum: [...WEEKDAYS] },
          note: { type: "string", description: "One short line for the day, or empty" },
          meals: {
            type: "array",
            description: "One entry per slot, in the order of the slots",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slot", "free", "description", "foods", "macros"],
              properties: {
                slot: { type: "string", description: "The slot id" },
                free: { type: "boolean", description: "True only for the free meals requested" },
                description: { type: "string", description: "Short readable name of the dish" },
                foods: {
                  type: "array",
                  description: "The foods with their quantity; empty for a free meal",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "quantity", "unit"],
                    properties: { name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", description: "g, ml, or a count unit such as pz" } },
                  },
                },
                macros: { ...macrosJson, description: "Nutrients of the whole meal; all zero for a free meal" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const round1 = (value: number) => Math.round(value * 10) / 10;

export type GeneratedMeal = GeneratedPlan["days"][number]["meals"][number];

/** One meal of the AI answer as a PlannedMeal; title, time and type come from its slot (or the meal it replaces). */
export function toPlannedMeal(meal: GeneratedMeal | undefined, base: { title: string; time?: string; type?: PlanSlot["type"] }): PlannedMeal {
  if (!meal || meal.free || meal.foods.length === 0) return { ...base, free: true as const, ...(meal?.description ? { description: meal.description } : {}) };
  const m = meal.macros;
  const sugar = round1(m.sugar);
  return {
    ...base,
    description: meal.description || meal.foods.map((f) => f.name).join(", "),
    foods: meal.foods.map((f) => ({ name: f.name, quantity: round1(f.quantity), unit: f.unit })),
    macros: {
      kcal: Math.round(m.kcal),
      protein: round1(m.protein),
      carbs: round1(m.carbs),
      fat: round1(m.fat),
      fiber: round1(m.fiber),
      sugar,
      addedSugar: Math.min(sugar, round1(m.addedSugar)),
    },
  };
}

/** The AI answer as an Intake MealPlan (validated), with the slots giving titles, times and types. */
export function toMealPlan(answer: GeneratedPlan, slots: PlanSlot[], validFrom: string): MealPlan {
  const days = Object.fromEntries(
    WEEKDAYS.map((weekday) => {
      const day = answer.days.find((d) => d.day === weekday);
      const meals: PlannedMeal[] = slots.map((slot) =>
        toPlannedMeal(
          day?.meals.find((m) => m.slot === slot.id),
          { title: slot.label, time: slot.time, type: slot.type },
        ),
      );
      return [weekday, { ...(day?.note ? { note: day.note.slice(0, 80) } : {}), meals }];
    }),
  ) as MealPlan["days"];
  const notes = answer.notes.filter(Boolean);
  return mealPlanSchema.parse({ schemaVersion: MEAL_PLAN_SCHEMA_VERSION, validFrom, ...(notes.length ? { notes } : {}), days });
}

/** JSON schema of one meal, for "Sostituisci" (the same shape as a meal of the whole plan). */
export const GENERATED_MEAL_JSON_SCHEMA = GENERATED_PLAN_JSON_SCHEMA.properties.days.items.properties.meals.items;
export const generatedMealSchema = generatedPlanSchema.shape.days.element.shape.meals.element;

/** The plan with one meal replaced (validated). */
export function replaceMeal(plan: MealPlan, day: Weekday, index: number, meal: PlannedMeal): MealPlan {
  const meals = plan.days[day].meals.map((current, i) => (i === index ? meal : current));
  return mealPlanSchema.parse({ ...plan, days: { ...plan.days, [day]: { ...plan.days[day], meals } } });
}

/**
 * The plan with a new time for one meal; with allDays, for the meal at the same position on every day (the same slot
 * all week). Meals stay in the order of the day.
 */
export function setMealTime(plan: MealPlan, day: Weekday, index: number, time: string, allDays: boolean): MealPlan {
  const days = Object.fromEntries(
    WEEKDAYS.map((weekday) => {
      const current = plan.days[weekday];
      if (!allDays && weekday !== day) return [weekday, current];
      return [weekday, { ...current, meals: current.meals.map((meal, i) => (i === index ? { ...meal, time } : meal)) }];
    }),
  );
  return mealPlanSchema.parse({ ...plan, days });
}

/**
 * The plan with the dish of one meal swapped with the same meal of another day ("Sposta in un altro giorno"): the dish
 * (description, foods, macros, or the free meal) changes place, while each slot keeps its title, time and type.
 */
export function swapMeals(plan: MealPlan, day: Weekday, index: number, toDay: Weekday): MealPlan {
  const a = plan.days[day].meals[index];
  const b = plan.days[toDay].meals[index];
  if (!a || !b || day === toDay) return plan;
  const split = (meal: PlannedMeal) => {
    const { title, time, type, ...dish } = meal;
    return { base: { title, ...(time !== undefined ? { time } : {}), ...(type !== undefined ? { type } : {}) }, dish };
  };
  const [sa, sb] = [split(a), split(b)];
  const put = (weekday: Weekday, meal: PlannedMeal) => ({ ...plan.days[weekday], meals: plan.days[weekday].meals.map((m, i) => (i === index ? meal : m)) });
  return mealPlanSchema.parse({
    ...plan,
    days: { ...plan.days, [day]: put(day, { ...sa.base, ...sb.dish } as PlannedMeal), [toDay]: put(toDay, { ...sb.base, ...sa.dish } as PlannedMeal) },
  });
}

/** Body of "Sposta" on a draft or a stored plan: the meal and the day whose same meal it swaps with. */
export const mealMoveSchema = z.object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), toDay: z.enum(WEEKDAYS) }).strict();
export type MealMove = z.infer<typeof mealMoveSchema>;

/** Body of the time change on a draft or a stored plan. */
export const mealTimeChangeSchema = z
  .object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), time, allDays: z.boolean() })
  .strict();
export type MealTimeChange = z.infer<typeof mealTimeChangeSchema>;

/** Body of "Sostituisci" on a draft: the meal and an optional wish ("più leggero"). */
export const mealReplaceSchema = z
  .object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), note: z.string().trim().max(200) })
  .strict();
export type MealReplace = z.infer<typeof mealReplaceSchema>;

// ── Checks ────────────────────────────────────────────────

/** Day calories within this share of the goal count as on target. */
export const PLAN_KCAL_TOLERANCE = 0.07;
/** Protein may be this many grams under the goal. */
export const PLAN_PROTEIN_TOLERANCE_G = 10;

export interface PlanDayCheck {
  day: Weekday;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** A free meal makes the day's totals partial: they are shown but not checked. */
  hasFreeMeal: boolean;
  /** Within the tolerances (null when unchecked: free meal or no goal). */
  onTarget: boolean | null;
}

/** A broken constraint; `index` / `at` give the meal's position in the day, to mark it in the review. */
export type PlanViolation =
  | { kind: "allergen"; day: Weekday; index: number; meal: string; term: string }
  | { kind: "disliked"; day: Weekday; index: number; meal: string; term: string }
  | { kind: "repeated"; meal: string; times: number; max: number; at: Array<{ day: Weekday; index: number }> }
  | { kind: "sameDay"; day: Weekday; index: number; meal: string }
  | { kind: "freeMeal"; day: Weekday; index: number; meal: string; expected: boolean };

export interface PlanChecks {
  days: PlanDayCheck[];
  violations: PlanViolation[];
}

/** Lower case without accents, for matching food names ("Ricotta" ~ "ricotta", "caffè" ~ "caffe"). */
export const normalizeFoodText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** A dish, for counting repeats: its food names, without quantities and order. */
const signature = (meal: PlannedMeal) =>
  "foods" in meal && meal.foods
    ? meal.foods
        .map((f) => normalizeFoodText(f.name))
        .sort()
        .join("|")
    : "";

/** Day totals against the targets, and every constraint the preferences make checkable. */
export function checkPlan(plan: MealPlan, targets: PlanTargets, preferences: PlanPreferences): PlanChecks {
  const violations: PlanViolation[] = [];
  const counts = new Map<string, { times: number; title: string; type: string; at: Array<{ day: Weekday; index: number }> }>();
  const days = WEEKDAYS.map((weekday): PlanDayCheck => {
    const meals = plan.days[weekday].meals;
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const seenToday = new Set<string>();
    meals.forEach((meal, index) => {
      const slot = preferences.slots[index];
      const wantFree = Boolean(slot && preferences.freeMeals.some((f) => f.day === weekday && f.slot === slot.id));
      const isFree = meal.free === true;
      if (wantFree !== isFree) violations.push({ kind: "freeMeal", day: weekday, index, meal: meal.title, expected: wantFree });
      if (isFree || !("foods" in meal)) return;
      if (meal.macros) {
        totals.kcal += meal.macros.kcal;
        totals.protein += meal.macros.protein;
        totals.carbs += meal.macros.carbs;
        totals.fat += meal.macros.fat;
      }
      const text = normalizeFoodText([meal.description ?? "", ...meal.foods.map((f) => f.name)].join(" "));
      for (const term of preferences.allergies) if (text.includes(normalizeFoodText(term))) violations.push({ kind: "allergen", day: weekday, index, meal: meal.title, term });
      for (const term of preferences.dislikes) if (text.includes(normalizeFoodText(term))) violations.push({ kind: "disliked", day: weekday, index, meal: meal.title, term });
      const sig = signature(meal);
      if (!sig) return;
      if (preferences.noRepeatSameDay && seenToday.has(sig)) violations.push({ kind: "sameDay", day: weekday, index, meal: meal.title });
      seenToday.add(sig);
      const entry = counts.get(sig) ?? { times: 0, title: meal.description ?? meal.title, type: meal.type ?? "snack", at: [] };
      entry.times += 1;
      entry.at.push({ day: weekday, index });
      counts.set(sig, entry);
    });
    const hasFreeMeal = meals.some((meal) => meal.free === true);
    const kcalOk = targets.kcal === null ? null : Math.abs(totals.kcal - targets.kcal) <= targets.kcal * PLAN_KCAL_TOLERANCE;
    const proteinOk = targets.protein === null ? null : totals.protein >= targets.protein - PLAN_PROTEIN_TOLERANCE_G;
    const onTarget = hasFreeMeal || (kcalOk === null && proteinOk === null) ? null : kcalOk !== false && proteinOk !== false;
    return { day: weekday, kcal: Math.round(totals.kcal), protein: Math.round(totals.protein), carbs: Math.round(totals.carbs), fat: Math.round(totals.fat), hasFreeMeal, onTarget };
  });
  for (const entry of counts.values()) {
    if (entry.type === "breakfast" && preferences.sameBreakfastOk) continue;
    if (entry.times > preferences.maxSameMealPerWeek) violations.push({ kind: "repeated", meal: entry.title, times: entry.times, max: preferences.maxSameMealPerWeek, at: entry.at });
  }
  return { days, violations };
}

/** The problems of a check in plain English, for the correction round. */
export function describeProblems(checks: PlanChecks, targets: PlanTargets): string[] {
  const problems: string[] = [];
  for (const day of checks.days) {
    if (day.onTarget !== false) continue;
    problems.push(`${day.day}: ${day.kcal} kcal and ${day.protein} g protein; the targets are ${targets.kcal ?? "-"} kcal (±${Math.round(PLAN_KCAL_TOLERANCE * 100)}%) and at least ${targets.protein === null ? "-" : targets.protein - PLAN_PROTEIN_TOLERANCE_G} g protein.`);
  }
  for (const v of checks.violations) {
    if (v.kind === "allergen") problems.push(`${v.day} ${v.meal}: contains "${v.term}", which the person is allergic or intolerant to. Remove it.`);
    else if (v.kind === "disliked") problems.push(`${v.day} ${v.meal}: contains "${v.term}", which the person does not like. Replace it.`);
    else if (v.kind === "repeated") problems.push(`"${v.meal}" appears ${v.times} times in the week; at most ${v.max}. Vary it.`);
    else if (v.kind === "sameDay") problems.push(`${v.day}: "${v.meal}" repeats a dish already planned that day. Change it.`);
    else problems.push(`${v.day} ${v.meal}: ${v.expected ? "must be a free meal (free: true, no foods)" : "must not be a free meal"}.`);
  }
  return problems;
}

// ── API ───────────────────────────────────────────────────

/** GET /api/plans/generation: the stored preferences (or the defaults), the targets and the plan model. */
export interface PlanGenerationView {
  preferences: PlanPreferences;
  targets: PlanTargets;
  model: string;
  models: string[];
}

/** A generated plan not active yet, with its checks. */
export interface PlanDraft {
  plan: MealPlan;
  checks: PlanChecks;
  targets: PlanTargets;
  /** 1, or 2 when the server asked the AI to correct the first answer. */
  rounds: number;
}

/** GET /api/plans/generate/:id */
export interface PlanGenerationJob {
  id: string;
  status: "running" | "done" | "failed";
  /** Days written so far in the current round (0–7). */
  daysDone: number;
  round: number;
  /** Short reason when it failed (recognition_* codes, as for the photos). */
  error: string | null;
  draft: PlanDraft | null;
}
