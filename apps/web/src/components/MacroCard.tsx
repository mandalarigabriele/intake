import type { DayGoals, DayTotals } from "@intake/shared";
import { formatGrams } from "../lib/format";
import { t } from "../lib/strings";

export type MacroKey = "protein" | "carbs" | "fat" | "fiber";

export const MACROS: MacroKey[] = ["protein", "carbs", "fat", "fiber"];

interface Props {
  totals: DayTotals;
  goals: DayGoals;
}

/** One meter per macro: eaten / goal with the remaining (or excess) amount in words. */
export function MacroCard({ totals, goals }: Props) {
  return (
    <section className="card macro-card" aria-label="Macronutrienti">
      {MACROS.map((key) => {
        const eaten = totals[key];
        const goal = goals[key];
        const hasGoal = goal !== null && goal > 0;
        const over = hasGoal && eaten > goal;
        const ratio = hasGoal ? Math.min(eaten / goal, 1) : 0;
        const status = !hasGoal
          ? null
          : over
            ? t.macros.over(`${formatGrams(eaten - goal)} g`)
            : eaten === goal
              ? t.macros.reached
              : t.macros.left(`${formatGrams(goal - eaten)} g`);

        return (
          <div className="macro-row" key={key} data-macro={key} data-over={over || undefined}>
            <div className="macro-head">
              <span className="macro-name">{t.macros[key]}</span>
              <span className="macro-values">
                <strong>{formatGrams(eaten)}</strong>
                {hasGoal && ` / ${formatGrams(goal)}`} g
                {status && (
                  <span className="macro-status">
                    {" · "}
                    {over && <span aria-hidden="true">▲ </span>}
                    {status}
                  </span>
                )}
              </span>
            </div>
            <div
              className="meter"
              role="meter"
              aria-label={t.macros[key]}
              aria-valuemin={0}
              aria-valuemax={hasGoal ? goal : undefined}
              aria-valuenow={eaten}
            >
              <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
