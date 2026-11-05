import type { DayGoals, DayTotals } from "@intake/shared";
import { z } from "zod";
import { ParseError, type Parsed } from "./common.js";

/**
 * Parses the structuredContent of get_goal_progress (it has an output schema, so no text parsing).
 * Only the fields Intake uses are validated; extra fields are ignored so server additions do not break us.
 */

const nullableNumber = z.number().nullable().optional().transform((v) => v ?? null);

const schema = z.object({
  date: z.string(),
  goals: z
    .object({
      calories: nullableNumber,
      protein_g: nullableNumber,
      carbs_g: nullableNumber,
      fat_g: nullableNumber,
      fiber_g: nullableNumber,
      water_ml: nullableNumber,
    })
    .nullable(),
  totals: z.object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    water_ml: z.number(),
  }),
});

export interface GoalProgress {
  date: string;
  goals: DayGoals;
  totals: DayTotals;
}

export function parseGoalProgress(structured: unknown): Parsed<GoalProgress> {
  const result = schema.safeParse(structured);
  if (!result.success) {
    throw new ParseError(`unexpected get_goal_progress structuredContent (${result.error.issues[0]?.message})`, JSON.stringify(structured));
  }
  const { date, goals, totals } = result.data;
  return {
    value: {
      date,
      goals: {
        kcal: goals?.calories ?? null,
        protein: goals?.protein_g ?? null,
        carbs: goals?.carbs_g ?? null,
        fat: goals?.fat_g ?? null,
        fiber: goals?.fiber_g ?? null,
        waterMl: goals?.water_ml ?? null,
      },
      totals: {
        kcal: totals.calories,
        protein: totals.protein_g,
        carbs: totals.carbs_g,
        fat: totals.fat_g,
        fiber: totals.fiber_g,
        waterMl: totals.water_ml,
      },
    },
    warnings: [],
  };
}
