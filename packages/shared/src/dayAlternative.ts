import { z } from "zod";
import type { MealTypeValue } from "./mealPlan.js";

/**
 * "Alternativa" in the Timeline (docs/day-alternative.md): another dish for one planned meal of today only, calibrated
 * on what is left of the day's goals. The AI answers with the foods and the nutrients of each food, so the
 * confirmation screen can scale the amounts as for a favorite.
 */

const nutrient = z.number().min(0).max(5000);

export const dayAlternativeFoodSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive().max(5000),
  unit: z.string().trim().min(1).max(12),
  kcal: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient,
  sugar: nutrient,
  addedSugar: nutrient,
});

export const dayAlternativeSchema = z.strictObject({
  description: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(400),
  foods: z.array(dayAlternativeFoodSchema).min(1).max(12),
});
export type DayAlternativeAnswer = z.infer<typeof dayAlternativeSchema>;

/** JSON schema of the AI answer (structured output: every object closed, every field required). */
export const DAY_ALTERNATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "reason", "foods"],
  properties: {
    description: { type: "string", description: "Short readable name of the dish" },
    reason: { type: "string", description: "One or two short sentences: why it fits what is left of the day and the week" },
    foods: {
      type: "array",
      description: "The foods with their quantity; the nutrients are those of that quantity, not per 100 g",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit", "kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number", description: "Amount of the food" },
          unit: { type: "string", description: "g or ml for anything weighed, pz for pieces" },
          kcal: { type: "number" },
          protein: { type: "number", description: "grams" },
          carbs: { type: "number", description: "grams" },
          fat: { type: "number", description: "grams" },
          fiber: { type: "number", description: "grams" },
          sugar: { type: "number", description: "grams, total" },
          addedSugar: { type: "number", description: "grams, part of sugar; 0 for whole foods" },
        },
      },
    },
  },
} as const;

export interface DayMacros {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

type Amounts = Record<keyof DayMacros, number>;

/** What the dish should aim for: the day's goals minus what is eaten and what the other planned meals still bring. */
export interface DayBudget {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

const FLOORS: Amounts = { kcal: 150, protein: 5, carbs: 0, fat: 0, fiber: 0 };

/**
 * The room left for one meal. Without a goal for a nutrient the meal's own planned value is used (null when it has
 * none); a day already over its goals still gets a small meal, never a negative one.
 */
export function dayBudget(goals: DayMacros, eaten: Amounts, reserved: Amounts, own: DayMacros | null): DayBudget {
  const out = {} as DayBudget;
  for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
    const goal = goals[key];
    out[key] = goal === null ? (own?.[key] ?? null) : Math.round(Math.max(FLOORS[key], goal - eaten[key] - reserved[key]));
  }
  return out;
}

/** The alternative as the app shows it and logs it (POST /api/days/today/alternative). */
export interface DayAlternative {
  /** The planned meal it replaces, today. */
  planIndex: number;
  title: string;
  time: string;
  type: MealTypeValue;
  description: string;
  reason: string;
  budget: DayBudget;
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    nutrients: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; addedSugar: number };
  }>;
}

export const dayAlternativeRequestSchema = z.strictObject({ index: z.number().int().min(0).max(9), note: z.string().trim().max(300) });
export type DayAlternativeRequest = z.infer<typeof dayAlternativeRequestSchema>;
