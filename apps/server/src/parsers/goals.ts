import type { NutritionGoals } from "@intake/shared";
import { leadingNumber, type Parsed } from "./common.js";

/**
 * Parses get_nutrition_goals output:
 *
 *   Current daily goals:
 *   - Calories: 2200 kcal
 *   - Protein: 135g
 *   - Saturated fat (max): not set
 *   - Water: 2500 ml
 *   - Target weight: not set
 */

const LINE = /^-\s*([^:]+):\s*(.*)$/;
const WEIGHT = /^(\d+(?:\.\d+)?)\s*(kg|lb)s?\b/i;

type NumericKey = "kcal" | "protein" | "carbs" | "fat" | "fiber" | "waterMl";
type LimitKey = keyof NutritionGoals["limits"];

const TARGETS: Record<string, NumericKey> = {
  Calories: "kcal",
  Protein: "protein",
  Carbs: "carbs",
  Fat: "fat",
  Fiber: "fiber",
  Water: "waterMl",
};

const LIMITS: Record<string, LimitKey> = {
  "Saturated fat (max)": "saturatedFat",
  "Sugar, total (max)": "sugar",
  "Added sugar (max)": "addedSugar",
  "Alcohol (max)": "alcohol",
  "Caffeine (max)": "caffeineMg",
  "Sodium (max)": "sodiumMg",
};

export function parseGoals(text: string): Parsed<NutritionGoals> {
  const warnings: string[] = [];
  const goals: NutritionGoals = {
    kcal: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    waterMl: null,
    limits: { saturatedFat: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null },
    targetWeight: null,
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const match = LINE.exec(rawLine.trim());
    if (!match) continue;
    const label = match[1]!.trim();
    const value = match[2]!.trim();

    if (label in TARGETS) {
      goals[TARGETS[label]!] = leadingNumber(value);
    } else if (label in LIMITS) {
      goals.limits[LIMITS[label]!] = leadingNumber(value);
    } else if (label === "Target weight") {
      const weight = WEIGHT.exec(value);
      goals.targetWeight = weight ? { value: Number(weight[1]), unit: weight[2]!.toLowerCase() as "kg" | "lb" } : null;
      if (!weight && leadingNumber(value) !== null) warnings.push(`goals: unrecognized target weight "${value}"`);
    } else {
      warnings.push(`goals: unknown goal "${label}"`);
    }
  }

  return { value: goals, warnings };
}
