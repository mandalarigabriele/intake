import type { DayView } from "@intake/shared";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

// Geometry from the Today mockup: 06:00 → 22:00 across 4..272, kcal from the baseline at 112
const W = 318;
const X0 = 4;
const X1 = 272;
const BASE = 112;
const TOP = 14;
const START = 6 * 60;
const END = 22 * 60;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clampTime = (m: number) => Math.min(END, Math.max(START, m));

interface Step {
  minute: number;
  kcal: number;
}

/** Cumulative kcal as a stepped series: flat until each meal, then up by its kcal. */
function cumulative(steps: Step[]): Array<{ minute: number; total: number }> {
  let total = 0;
  return [...steps]
    .sort((a, b) => a.minute - b.minute)
    .map((s) => {
      total += s.kcal;
      return { minute: s.minute, total };
    });
}

/**
 * "Andamento della giornata" in the calorie card (docs/design § Charts): kcal eaten through the day as a stepped line with area,
 * the plan as a dashed stepped line, the "now" marker and "a quest'ora: X su Y previste".
 */
export function DayCurve({ view }: { view: DayView }) {
  const eaten = cumulative(view.meals.map((m) => ({ minute: toMinutes(m.time), kcal: m.nutrients.kcal })));
  const planSteps = (view.comparison?.meals ?? []).flatMap((m) => (m.planned ? [{ minute: toMinutes(m.time), kcal: m.planned.kcal, title: m.title }] : []));
  const plan = cumulative(planSteps);
  const planTotal = plan.at(-1)?.total ?? 0;
  const eatenTotal = view.totals.kcal;
  if (eaten.length === 0 && plan.length === 0) return null;

  const now = view.isToday ? clampTime(toMinutes(view.clock.localTime)) : END;
  const max = Math.max(2000, planTotal, eatenTotal, view.goals.kcal ?? 0) * 1.08;
  const x = (minute: number) => X0 + ((clampTime(minute) - START) / (END - START)) * (X1 - X0);
  const y = (kcal: number) => BASE - (kcal / max) * (BASE - TOP);
  const stepped = (points: Array<{ minute: number; total: number }>, until: number) => {
    const out: string[] = [`${x(START).toFixed(1)},${BASE}`];
    let level = 0;
    for (const p of points) {
      if (p.minute > until) break;
      out.push(`${x(p.minute).toFixed(1)},${y(level).toFixed(1)}`, `${x(p.minute).toFixed(1)},${y(p.total).toFixed(1)}`);
      level = p.total;
    }
    out.push(`${x(until).toFixed(1)},${y(level).toFixed(1)}`);
    return { points: out, level };
  };
  const eatenLine = stepped(eaten, now);
  const planLine = stepped(plan, END);
  const plannedSoFar = plan.filter((p) => p.minute <= now).at(-1)?.total ?? 0;
  // Grid labels sit on the right like the "piano" label: drop one that would collide with it
  const grid = [1000, 2000, 3000].filter((g) => g < max);
  const showGridLabel = (g: number) => plan.length === 0 || Math.abs(y(g) - y(planTotal)) >= 12;
  const hours = [8, 12, 16, 20];
  const nowLabel = view.isToday ? view.clock.localTime.slice(0, 5) : null;
  const area = `M${eatenLine.points.join(" L")} L${x(now).toFixed(1)},${BASE} Z`;

  return (
    <div className="day-curve">
      <span className="day-curve-title">{t.dayCurve.title}</span>
      <svg viewBox={`0 0 ${W} 132`} role="img" aria-label={t.dayCurve.aria(formatKcal(eatenTotal), nowLabel, planTotal ? formatKcal(planTotal) : null)}>
        {grid.map((g) => (
          <g key={g}>
            <line className="curve-grid" x1={X0} x2={X1} y1={y(g)} y2={y(g)} />
            {showGridLabel(g) && (
              <text className="curve-axis" x={X1 + 4} y={y(g) + 4}>
                {formatKcal(g)}
              </text>
            )}
          </g>
        ))}
        <line className="curve-base" x1={X0} x2={X1} y1={BASE} y2={BASE} />
        {hours.map((h) => (
          <text key={h} className="curve-axis" x={x(h * 60)} y="127" textAnchor="middle">
            {String(h).padStart(2, "0")}
          </text>
        ))}
        {plan.length > 0 && <polyline className="curve-plan" points={planLine.points.join(" ")} />}
        <path className="curve-area" d={area} />
        <polyline className="curve-eaten" points={eatenLine.points.join(" ")} />
        {view.isToday && <line className="curve-now" x1={x(now)} x2={x(now)} y1="10" y2={BASE} />}
        <circle className="curve-dot" cx={x(now)} cy={y(eatenLine.level)} r="4.5">
          <title>{nowLabel ? t.dayCurve.at(nowLabel, formatKcal(eatenTotal)) : `${formatKcal(eatenTotal)} kcal`}</title>
        </circle>
        <text className="curve-you" x={Math.min(x(now) + 7, X1 - 40)} y={y(eatenLine.level) - 6}>
          {t.dayCurve.you(formatKcal(eatenTotal))}
        </text>
        {plan.length > 0 && (
          <text className="curve-plan-label" x={X1 + 4} y={y(planTotal) + 4}>
            {t.dayCurve.plan}
          </text>
        )}
        {planSteps.map((s) => (
          <circle key={`${s.minute}-${s.title}`} className="curve-hit" cx={x(s.minute)} cy={BASE} r="7">
            <title>{t.dayCurve.planStep(s.title, s.minute, formatKcal(s.kcal))}</title>
          </circle>
        ))}
      </svg>
      <div className="day-curve-legend">
        <span className="day-curve-keys">
          <span>
            <span className="key-eaten" aria-hidden="true" />
            {t.dayCurve.eaten}
          </span>
          {plan.length > 0 && (
            <span>
              <span className="key-plan" aria-hidden="true" />
              {t.dayCurve.planKey}
            </span>
          )}
        </span>
        {plan.length > 0 && (
          <span>
            {view.isToday ? t.dayCurve.soFar : t.dayCurve.total} <strong>{formatKcal(eatenTotal)}</strong> {t.dayCurve.ofPlanned(formatKcal(view.isToday ? plannedSoFar : planTotal))}
          </span>
        )}
      </div>
    </div>
  );
}
