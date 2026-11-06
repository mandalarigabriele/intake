import { ParseError, type Parsed } from "./common.js";

/**
 * Parses get_meal_patterns (text only):
 *
 *   Patterns — 2026-10-31 to 2026-11-06 (3 logged days of 7)
 *   …
 *   Breakfast effect:
 *     Days WITH breakfast: 2 — 1514.5 kcal, 76.1g P, 1250 ml water
 *     Days WITHOUT breakfast: 1 — 790 kcal, 49.4g P, 0 ml water
 *
 * Other sections (late dinners, weekday vs weekend, outliers…) appear only with enough data and are
 * not parsed until a real sample is available; Intake computes those insights from structured data.
 */

export interface EffectGroup {
  days: number;
  kcal: number;
  protein: number;
  waterMl: number | null;
}

export interface MealPatterns {
  startDate: string;
  endDate: string;
  loggedDays: number;
  windowDays: number;
  breakfast: { with: EffectGroup; without: EffectGroup } | null;
}

const HEADER = /Patterns\s*[—-]\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*\((\d+)\s+logged days?\s+of\s+(\d+)\)/i;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const GROUP = (label: string) =>
  new RegExp(`Days ${label} breakfast:\\s*(\\d+)\\s*[—-]\\s*${NUM}\\s*kcal,\\s*${NUM}\\s*g\\s*P(?:,\\s*${NUM}\\s*ml water)?`, "i");

function group(text: string, label: string): EffectGroup | null {
  const match = GROUP(label).exec(text);
  if (!match) return null;
  return {
    days: Number(match[1]),
    kcal: Number(match[2]),
    protein: Number(match[3]),
    waterMl: match[4] === undefined ? null : Number(match[4]),
  };
}

export function parseMealPatterns(text: string): Parsed<MealPatterns> {
  const header = HEADER.exec(text);
  if (!header) {
    // "No meals logged…" style answers: nothing to analyse
    if (/no meals|not enough/i.test(text)) {
      return { value: { startDate: "", endDate: "", loggedDays: 0, windowDays: 0, breakfast: null }, warnings: [] };
    }
    throw new ParseError("unrecognized get_meal_patterns response", text);
  }
  const withBreakfast = group(text, "WITH");
  const withoutBreakfast = group(text, "WITHOUT");
  return {
    value: {
      startDate: header[1]!,
      endDate: header[2]!,
      loggedDays: Number(header[3]),
      windowDays: Number(header[4]),
      breakfast: withBreakfast && withoutBreakfast ? { with: withBreakfast, without: withoutBreakfast } : null,
    },
    warnings: [],
  };
}
