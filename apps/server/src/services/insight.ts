import type { InsightResponse, Meal } from "@intake/shared";
import type { HealthSleep } from "../parsers/healthAutoExport.js";
import type { MealPatterns } from "../parsers/mealPatterns.js";
import type { NutritionSummary } from "../parsers/summary.js";

/** Below this many logged days in the window the card is hidden (docs/design/DESIGN.md). */
export const MIN_LOGGED_DAYS = 3;
export const WINDOW_DAYS = 7;
/** Health comparisons need at least 5 days in each group (docs/apple-health.md § Insights), so they look further back. */
export const HEALTH_WINDOW_DAYS = 28;
export const MIN_GROUP_DAYS = 5;
/** Smallest relative difference worth a sentence. */
export const MIN_DIFFERENCE = 0.1;

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const round = (value: number) => integer.format(Math.round(value));

export interface InsightInput {
  today: string;
  patterns: MealPatterns;
  meals: Meal[];
  /** Daily totals over the last HEALTH_WINDOW_DAYS days (the weekday/weekend sentence uses the last WINDOW_DAYS). */
  summary: NutritionSummary;
  proteinGoal: number | null;
  /** Apple Health data over the same 28 days; omitted when nothing was imported. */
  health?: { nights: HealthSleep[]; steps: Array<{ date: string; value: number }>; stepGoal: number };
}

export interface Candidate {
  text: string;
  /** Days the sentence looks at (7 for Nutrition-only sentences, 28 for the Health ones). */
  windowDays: number;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Two groups of days compared on kcal eaten: only when both have enough days and the gap is meaningful. */
function compareKcal(a: number[], b: number[]): { a: number; b: number } | null {
  if (a.length < MIN_GROUP_DAYS || b.length < MIN_GROUP_DAYS) return null;
  const avgA = mean(a);
  const avgB = mean(b);
  if (Math.abs(avgA - avgB) < Math.min(avgA, avgB) * MIN_DIFFERENCE) return null;
  return { a: avgA, b: avgB };
}

/**
 * Sentences that cross Apple Health with what was eaten, over completed logged days (today is left out):
 * calories after a short night (under 7 hours, assigned to the wake-up day) and on days at the step goal.
 */
export function healthCandidates({ today, summary, health }: InsightInput): Candidate[] {
  if (!health) return [];
  const from = addDays(today, -(HEALTH_WINDOW_DAYS - 1));
  const eaten = new Map(summary.days.filter((d) => d.mealCount > 0 && d.date >= from && d.date < today).map((d) => [d.date, d.kcal]));
  const candidates: Candidate[] = [];

  const short: number[] = [];
  const rested: number[] = [];
  for (const night of health.nights) {
    const kcal = eaten.get(night.date);
    if (kcal === undefined) continue;
    (night.asleepMinutes < 420 ? short : rested).push(kcal);
  }
  const sleep = compareKcal(short, rested);
  if (sleep) {
    candidates.push({
      text: `Dopo una notte sotto le 7 ore mangi in media ${round(sleep.a)} kcal, contro ${round(sleep.b)} kcal quando dormi di più.`,
      windowDays: HEALTH_WINDOW_DAYS,
    });
  }

  const active: number[] = [];
  const quiet: number[] = [];
  for (const day of health.steps) {
    const kcal = eaten.get(day.date);
    if (kcal === undefined) continue;
    (day.value >= health.stepGoal ? active : quiet).push(kcal);
  }
  const steps = compareKcal(active, quiet);
  if (steps) {
    candidates.push({
      text: `Nei giorni con almeno ${round(health.stepGoal)} passi mangi in media ${round(steps.a)} kcal, contro ${round(steps.b)} kcal negli altri.`,
      windowDays: HEALTH_WINDOW_DAYS,
    });
  }
  return candidates;
}

/**
 * Candidate sentences built only from real figures; one is picked per day, deterministically,
 * so the card is stable during the day and changes from one day to the next. No LLM involved.
 */
export function insightCandidates(input: InsightInput): Candidate[] {
  const { today, patterns, meals, summary, proteinGoal } = input;
  const candidates: string[] = [];

  // Breakfast effect, as computed by the Nutrition server
  const breakfast = patterns.breakfast;
  if (breakfast && breakfast.with.days > 0 && breakfast.without.days > 0 && Math.abs(breakfast.with.protein - breakfast.without.protein) >= 5) {
    candidates.push(
      `Nei giorni in cui fai colazione arrivi a ${round(breakfast.with.protein)} g di proteine, contro ${round(breakfast.without.protein)} g quando la salti.`,
    );
  }

  // Protein per meal against the daily goal
  const loggedDays = new Set(meals.map((m) => m.date)).size;
  if (proteinGoal && meals.length >= 3 && loggedDays > 0) {
    const perMeal = meals.reduce((sum, m) => sum + m.nutrients.protein, 0) / meals.length;
    const mealsPerDay = meals.length / loggedDays;
    const needed = proteinGoal / Math.max(3, Math.round(mealsPerDay));
    if (needed - perMeal >= 3) {
      candidates.push(
        `In media un pasto ti porta ${round(perMeal)} g di proteine: per arrivare a ${round(proteinGoal)} g al giorno ne servono circa ${round(needed)} a pasto.`,
      );
    }
  }

  // Weekday vs weekend calories (logged days of the last week only)
  const weekStart = addDays(today, -(WINDOW_DAYS - 1));
  const logged = summary.days.filter((d) => d.mealCount > 0 && d.date >= weekStart);
  const weekend = logged.filter((d) => [0, 6].includes(new Date(`${d.date}T12:00:00Z`).getUTCDay()));
  const weekday = logged.filter((d) => !weekend.includes(d));
  if (weekend.length >= 1 && weekday.length >= 2) {
    const avg = (days: typeof logged) => days.reduce((sum, d) => sum + d.kcal, 0) / days.length;
    const weekendAvg = avg(weekend);
    const weekdayAvg = avg(weekday);
    if (Math.abs(weekendAvg - weekdayAvg) >= 150) {
      candidates.push(`Nel weekend mangi in media ${round(weekendAvg)} kcal, contro ${round(weekdayAvg)} kcal nei giorni feriali.`);
    }
  }

  return [...candidates.map((text) => ({ text, windowDays: WINDOW_DAYS })), ...healthCandidates(input)];
}

export function pickInsight(input: InsightInput): InsightResponse["insight"] {
  if (input.patterns.loggedDays < MIN_LOGGED_DAYS) return null;
  const candidates = insightCandidates(input);
  if (candidates.length === 0) return null;
  const dayNumber = Math.floor(Date.parse(`${input.today}T12:00:00Z`) / 86_400_000);
  const chosen = candidates[dayNumber % candidates.length]!;
  // Logged days in the window the sentence looks at
  const from = addDays(input.today, -(chosen.windowDays - 1));
  const days =
    chosen.windowDays === WINDOW_DAYS ? input.patterns.loggedDays : input.summary.days.filter((d) => d.mealCount > 0 && d.date >= from).length;
  return {
    text: chosen.text,
    window: `Ultimi ${chosen.windowDays} giorni · ${days === 1 ? "1 giorno registrato" : `${days} giorni registrati`}`,
  };
}
