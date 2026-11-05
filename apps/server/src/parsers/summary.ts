import type { WeightEntry } from "@intake/shared";
import { z } from "zod";
import { ParseError, type Parsed } from "./common.js";

/**
 * Structured content of get_nutrition_summary and get_weight_trends (both have output schemas).
 * Only the fields Intake uses are validated.
 */

const summarySchema = z.object({
  goals: z
    .object({ calories: z.number().nullable().optional(), protein_g: z.number().nullable().optional() })
    .nullable()
    .optional(),
  days: z.array(
    z.object({
      date: z.string(),
      calories: z.number(),
      protein_g: z.number(),
      meal_count: z.number(),
    }),
  ),
});

export interface NutritionSummary {
  goals: { kcal: number | null; protein: number | null };
  days: Array<{ date: string; kcal: number; protein: number; mealCount: number }>;
}

export function parseNutritionSummary(structured: unknown): Parsed<NutritionSummary> {
  const result = summarySchema.safeParse(structured);
  if (!result.success) throw new ParseError("unexpected get_nutrition_summary structuredContent", JSON.stringify(structured));
  return {
    value: {
      goals: { kcal: result.data.goals?.calories ?? null, protein: result.data.goals?.protein_g ?? null },
      days: result.data.days.map((d) => ({ date: d.date, kcal: d.calories, protein: d.protein_g, mealCount: d.meal_count })),
    },
    warnings: [],
  };
}

const weightSchema = z.object({
  unit: z.string(),
  target: z.number().nullable().optional(),
  days: z.array(z.object({ date: z.string(), weight: z.number() })),
});

export interface WeightTrend {
  unit: string;
  target: number | null;
  entries: WeightEntry[];
}

export function parseWeightTrends(structured: unknown): Parsed<WeightTrend> {
  const result = weightSchema.safeParse(structured);
  if (!result.success) throw new ParseError("unexpected get_weight_trends structuredContent", JSON.stringify(structured));
  return {
    value: {
      unit: result.data.unit,
      target: result.data.target ?? null,
      entries: [...result.data.days].sort((a, b) => a.date.localeCompare(b.date)),
    },
    warnings: [],
  };
}
