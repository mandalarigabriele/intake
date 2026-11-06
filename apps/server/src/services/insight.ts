import type { InsightResponse, Meal } from "@intake/shared";
import type { MealPatterns } from "../parsers/mealPatterns.js";
import type { NutritionSummary } from "../parsers/summary.js";

/** Below this many logged days in the window the card is hidden (docs/design/DESIGN.md). */
export const MIN_LOGGED_DAYS = 3;
export const WINDOW_DAYS = 7;

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const round = (value: number) => integer.format(Math.round(value));

export interface InsightInput {
  today: string;
  patterns: MealPatterns;
  meals: Meal[];
  summary: NutritionSummary;
  proteinGoal: number | null;
}

/**
 * Candidate sentences built only from real figures; one is picked per day, deterministically,
 * so the card is stable during the day and changes from one day to the next. No LLM involved.
 */
export function insightCandidates({ patterns, meals, summary, proteinGoal }: InsightInput): string[] {
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

  // Weekday vs weekend calories (logged days only)
  const logged = summary.days.filter((d) => d.mealCount > 0);
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

  return candidates;
}

export function pickInsight(input: InsightInput): InsightResponse["insight"] {
  if (input.patterns.loggedDays < MIN_LOGGED_DAYS) return null;
  const candidates = insightCandidates(input);
  if (candidates.length === 0) return null;
  const dayNumber = Math.floor(Date.parse(`${input.today}T12:00:00Z`) / 86_400_000);
  const days = input.patterns.loggedDays;
  return {
    text: candidates[dayNumber % candidates.length]!,
    window: `Ultimi ${WINDOW_DAYS} giorni · ${days === 1 ? "1 giorno registrato" : `${days} giorni registrati`}`,
  };
}
