import { formatKcal, formatPercent } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  eaten: number;
  goal: number | null;
}

// Geometry from the design mockup: 132 px box, radius 56, 12 px stroke
const SIZE = 132;
const STROKE = 12;
const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Calorie meter: a ring with eaten / goal, the remaining amount as the hero number. */
export function CalorieCard({ eaten, goal }: Props) {
  const hasGoal = goal !== null && goal > 0;
  const ratio = hasGoal ? eaten / goal : 0;
  const over = hasGoal && eaten > goal;
  const remaining = hasGoal ? Math.abs(goal - eaten) : eaten;
  const dash = CIRCUMFERENCE * Math.min(ratio, 1);

  return (
    <section className="card calorie-card" aria-label="Calorie">
      <div className="ring" data-over={over || undefined}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={hasGoal ? `${formatKcal(eaten)} di ${formatKcal(goal)} kcal` : `${formatKcal(eaten)} kcal`}>
          <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
          {hasGoal && ratio > 0 && (
            <circle
              className="ring-fill"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </svg>
        <div className="ring-center">
          <span className="hero-number">{formatKcal(remaining)}</span>
          <span className="ring-label">{hasGoal ? (over ? t.calories.over : t.calories.left) : "kcal"}</span>
        </div>
      </div>

      <dl className="calorie-stats">
        <div>
          <dt>{t.calories.eaten}</dt>
          <dd>
            <strong>{formatKcal(eaten)}</strong> kcal
          </dd>
        </div>
        <div>
          <dt>{t.calories.goal}</dt>
          <dd>{hasGoal ? <><strong>{formatKcal(goal)}</strong> kcal</> : <span className="muted">{t.calories.noGoal}</span>}</dd>
        </div>
        {hasGoal && (
          <div>
            <span className="pill" data-over={over || undefined}>
              {over && <span aria-hidden="true">▲ </span>}
              {over ? t.calories.overGoal(formatPercent(ratio * 100)) : t.calories.ofDay(formatPercent(ratio * 100))}
            </span>
          </div>
        )}
      </dl>
    </section>
  );
}
