import { ParseError, leadingNumber, type Parsed } from "./common.js";

/**
 * USDA FoodData Central through the Nutrition MCP server: `search_foods` and `get_food_macros` (docs/plan-generation.md,
 * "Cerca nel database").
 *
 *   USDA FoodData Central generic foods, in USDA's order. Values are per 100 g.
 *   168910 · Pasta, whole-wheat, cooked · SR Legacy · calories 149 kcal · protein 5.99 g · carbs 30.1 g · fat 1.71 g
 *
 *   Pasta, whole-wheat, cooked
 *   USDA FoodData Central 168910 · SR Legacy
 *   Per 100 g: calories 149 kcal · protein 5.99 g · carbs 30.07 g · fat 1.71 g · … · fiber 3.9 g · sugar 0.75 g · …
 *   For 150 g: calories 224 kcal · …
 */

export interface FoodCandidate {
  id: number;
  description: string;
  /** Per 100 g. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodValues {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** null when USDA does not record it for the food. */
  fiber: number | null;
  sugar: number | null;
}

export interface FoodMacros {
  id: number;
  name: string;
  amountG: number;
  /** The values for amountG. */
  values: FoodValues;
}

export function parseFoodSearch(text: string): Parsed<FoodCandidate[]> {
  const warnings: string[] = [];
  const foods: FoodCandidate[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(" · ").map((p) => p.trim());
    // id · description (may contain " · ") · data type · 4 values
    if (parts.length < 7 || !/^\d+$/.test(parts[0]!)) continue;
    const values = parts.slice(-4);
    const [kcal, protein, carbs, fat] = [/^calories\s+(.+)$/, /^protein\s+(.+)$/, /^carbs\s+(.+)$/, /^fat\s+(.+)$/].map((pattern, i) => {
      const match = pattern.exec(values[i]!);
      return match ? leadingNumber(match[1]!) : null;
    });
    if (kcal === null || protein === null || carbs === null || fat === null || kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) {
      warnings.push(`search_foods line not understood: ${line.slice(0, 80)}`);
      continue;
    }
    foods.push({ id: Number(parts[0]), description: parts.slice(1, -5).join(" · "), kcal, protein, carbs, fat });
  }
  return { value: foods, warnings };
}

const LABELS: Record<string, keyof FoodValues> = { calories: "kcal", protein: "protein", carbs: "carbs", fat: "fat", fiber: "fiber", sugar: "sugar" };

function readValues(line: string): FoodValues | null {
  const out: Partial<Record<keyof FoodValues, number | null>> = {};
  for (const segment of line.slice(line.indexOf(":") + 1).split(" · ")) {
    const match = /^(.+?)\s+(-?\d+(?:\.\d+)?)\s*(?:kcal|g|mg)?$/.exec(segment.trim());
    const key = match ? LABELS[match[1]!.trim()] : undefined;
    if (match && key) out[key] = Number(match[2]);
  }
  if (out.kcal === undefined || out.protein === undefined || out.carbs === undefined || out.fat === undefined) return null;
  return { kcal: out.kcal!, protein: out.protein!, carbs: out.carbs!, fat: out.fat!, fiber: out.fiber ?? null, sugar: out.sugar ?? null };
}

/** The record of one food scaled to `amountG`: the "For N g" line when there is one, else the per 100 g line scaled here. */
export function parseFoodMacros(text: string, amountG: number): Parsed<FoodMacros> {
  const lines = text.split("\n");
  const name = lines[0]?.trim();
  const id = /USDA FoodData Central (\d+)/.exec(text)?.[1];
  const per100 = lines.find((l) => l.startsWith("Per 100 g:"));
  const forAmount = lines.find((l) => l.startsWith("For "));
  if (!name || !id || !per100) throw new ParseError("get_food_macros answer not understood", text);
  const base = readValues(per100);
  if (!base) throw new ParseError("get_food_macros without per 100 g values", per100);
  const warnings: string[] = [];
  let values = forAmount ? readValues(forAmount) : null;
  if (!values) {
    if (forAmount) warnings.push("get_food_macros 'For N g' line not understood; scaled from per 100 g");
    const k = amountG / 100;
    const scale = (v: number | null) => (v === null ? null : v * k);
    values = { kcal: base.kcal * k, protein: base.protein * k, carbs: base.carbs * k, fat: base.fat * k, fiber: scale(base.fiber), sugar: scale(base.sugar) };
  }
  return { value: { id: Number(id), name, amountG, values }, warnings };
}
