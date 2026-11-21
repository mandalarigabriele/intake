import { WEEKDAYS, foodLine, isFixedMeal, type MealPlan, type PlannedDay, type PlannedMeal, type Weekday } from "@intake/shared";
import { useEffect, useState, type ReactNode } from "react";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

export interface PlanGoals {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

/** Calories within this share of the goal count as on target, as in the plan checks. */
const KCAL_TOLERANCE = 0.07;
/** Grams below or above a macro goal that still count as on target. */
const GRAMS_TOLERANCE = 10;

/** Sum of the planned nutrients of a day; free meals have none. */
export function dayNutrients(day: PlannedDay) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, known: false, hasFree: false };
  for (const meal of day.meals) {
    if (!isFixedMeal(meal)) {
      sum.hasFree = true;
      continue;
    }
    if (!meal.macros) continue;
    sum.known = true;
    sum.kcal += meal.macros.kcal;
    sum.protein += meal.macros.protein;
    sum.carbs += meal.macros.carbs;
    sum.fat += meal.macros.fat;
    sum.fiber += meal.macros.fiber ?? 0;
  }
  return sum;
}

/** A time that is saved when the field is left (the picker sends a change for every wheel step on some browsers). */
function TimeField({ meal, onCommit, disabled }: { meal: PlannedMeal; onCommit: (time: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(meal.time ?? "");
  useEffect(() => setValue(meal.time ?? ""), [meal.time]);
  const commit = () => {
    if (/^\d{2}:\d{2}$/.test(value) && value !== meal.time) onCommit(value);
    else setValue(meal.time ?? "");
  };
  return (
    <input
      type="time"
      className="plan-time plan-time-edit"
      value={value}
      disabled={disabled}
      aria-label={t.plan.timeOf(meal.title)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export interface PlanDayMealsProps {
  day: PlannedDay;
  /** Present when times can be changed (draft or stored plan). */
  onTime?: (index: number, time: string) => void;
  timeBusy?: boolean;
  /** Plain-language problems of a meal (review of a generated plan). */
  warnings?: (index: number) => string[];
  /** Extra content under a meal, e.g. Sostituisci. */
  extra?: (meal: PlannedMeal, index: number) => ReactNode;
  /** A meal being replaced is dimmed. */
  busyIndex?: number | null;
}

/** The meals of one plan day: time (editable), name, kcal, dish, foods and macros. Used by Piano and the AI review. */
export function PlanDayMeals({ day, onTime, timeBusy, warnings, extra, busyIndex }: PlanDayMealsProps) {
  return (
    <div className="plan-meals">
      {day.meals.map((meal, i) => {
        const problems = warnings?.(i) ?? [];
        const time = onTime ? <TimeField meal={meal} disabled={timeBusy} onCommit={(value) => onTime(i, value)} /> : meal.time && <span className="plan-time">{meal.time}</span>;
        if (!isFixedMeal(meal)) {
          return (
            <article key={i} className="plan-meal" data-free data-warn={problems.length > 0 || undefined}>
              <header>
                {time}
                <h3>{meal.title}</h3>
                <span className="free-badge">{t.plan.freeBadge}</span>
              </header>
              {meal.description && <p className="plan-meal-dish">{meal.description}</p>}
              {problems.map((text, j) => (
                <p key={j} className="plan-meal-warn">
                  <span aria-hidden="true">⚠</span> {text}
                </p>
              ))}
              {extra?.(meal, i)}
            </article>
          );
        }
        const m = meal.macros;
        return (
          <article key={i} className="plan-meal" data-warn={problems.length > 0 || undefined} aria-busy={busyIndex === i || undefined}>
            <header>
              {time}
              <h3>{meal.title}</h3>
              {m && <span className="plan-meal-kcal">{formatKcal(m.kcal)} kcal</span>}
            </header>
            {meal.description && <p className="plan-meal-dish">{meal.description}</p>}
            <ul>
              {meal.foods.map((food, j) => (
                <li key={j}>{foodLine(food)}</li>
              ))}
            </ul>
            {m && <p className="plan-meal-macros">{t.plan.macroLine(formatKcal(m.protein), formatKcal(m.carbs), formatKcal(m.fat), formatKcal(m.fiber ?? 0))}</p>}
            {problems.map((text, j) => (
              <p key={j} className="plan-meal-warn">
                <span aria-hidden="true">⚠</span> {text}
              </p>
            ))}
            {extra?.(meal, i)}
          </article>
        );
      })}
    </div>
  );
}

function stateOf(value: number, goal: number, tolerance: number): { state: "ok" | "over" | "under"; text: string } {
  const diff = Math.round(value - goal);
  if (Math.abs(diff) <= tolerance) return { state: "ok", text: t.plan.inLine };
  return diff > 0 ? { state: "over", text: t.plan.above(formatKcal(diff)) } : { state: "under", text: t.plan.below(formatKcal(-diff)) };
}

/** Day totals against the goals, each with a bar and a text label ("in linea", "▲ 250 sopra"). */
export function PlanDaySummary({ day, goals, children }: { day: PlannedDay; goals: PlanGoals | null; children?: ReactNode }) {
  const sum = dayNutrients(day);
  if (!sum.known) return children ? <section className="card plan-summary">{children}</section> : null;
  const rows: Array<{ label: string; value: number; goal: number | null; unit: string; tolerance: number }> = [
    { label: t.calories.label, value: sum.kcal, goal: goals?.kcal ?? null, unit: "kcal", tolerance: goals?.kcal ? goals.kcal * KCAL_TOLERANCE : 0 },
    { label: t.macros.protein, value: sum.protein, goal: goals?.protein ?? null, unit: "g", tolerance: GRAMS_TOLERANCE },
    { label: t.macros.carbs, value: sum.carbs, goal: goals?.carbs ?? null, unit: "g", tolerance: GRAMS_TOLERANCE * 2 },
    { label: t.macros.fat, value: sum.fat, goal: goals?.fat ?? null, unit: "g", tolerance: GRAMS_TOLERANCE },
    { label: t.macros.fiber, value: sum.fiber, goal: goals?.fiber ?? null, unit: "g", tolerance: 5 },
  ];
  return (
    <section className="card plan-summary" aria-label={t.plan.dayTotal}>
      <span className="plan-summary-title">{t.plan.dayTotal}</span>
      {rows.map((row) => {
        const value = formatKcal(Math.round(row.value));
        const state = row.goal ? stateOf(row.value, row.goal, row.tolerance) : null;
        return (
          <div key={row.label} className="plan-summary-row" data-state={sum.hasFree ? undefined : state?.state}>
            <div className="plan-summary-line">
              <strong>{row.label}</strong>
              <span className="plan-summary-value">{row.goal ? t.plan.ofGoal(value, formatKcal(row.goal), row.unit) : t.plan.noGoalValue(value, row.unit)}</span>
            </div>
            {row.goal ? (
              <div className="plan-summary-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (row.value / row.goal) * 100)}%` }} />
              </div>
            ) : null}
            {state && !sum.hasFree && <span className="plan-summary-state">{state.text}</span>}
          </div>
        );
      })}
      {sum.hasFree && <p className="muted plan-summary-note">{t.plan.withoutFree}</p>}
      {children}
    </section>
  );
}

/** "Stesso orario tutti i giorni": a change of time applies to the same meal on every day. */
export function SameTimeSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="plan-same-time">
      <span>{t.plan.sameTime}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * "Sposta": the dish of a meal goes to the same meal of another day and that day's dish takes its place. The days are
 * listed with the dish they would send back, so the swap is clear before it is made.
 */
export function MoveMeal({ plan, day, index, onMove, busy, failed }: { plan: MealPlan; day: Weekday; index: number; onMove: (toDay: Weekday) => void; busy?: boolean; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  const meal = plan.days[day].meals[index];
  if (!meal) return null;
  if (!open) {
    return (
      <button type="button" className="plan-meal-action" disabled={busy} aria-label={t.plan.moveOf(meal.title)} onClick={() => setOpen(true)}>
        <MoveIcon />
        {t.plan.move}
      </button>
    );
  }
  return (
    <div className="plan-move" role="group" aria-label={t.plan.moveTitle}>
      <strong>{t.plan.moveTitle}</strong>
      <div className="plan-move-list">
        {WEEKDAYS.filter((w) => w !== day && plan.days[w].meals[index]).map((w) => {
          const other = plan.days[w].meals[index]!;
          const dish = isFixedMeal(other) ? (other.description ?? other.foods.map(foodLine).join(", ")) : t.plan.freeBadge.toLowerCase();
          return (
            <button
              key={w}
              type="button"
              className="plan-move-row"
              disabled={busy}
              onClick={() => {
                onMove(w);
                setOpen(false);
              }}
            >
              {t.plan.moveRow(t.weekdaysLong[WEEKDAYS.indexOf(w)]!, dish)}
            </button>
          );
        })}
      </div>
      <span className="muted">{t.plan.moveHint}</span>
      {failed && <p className="error-text">{t.plan.moveFailed}</p>}
      <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
        {t.plan.moveClose}
      </button>
    </div>
  );
}

function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />
    </svg>
  );
}
