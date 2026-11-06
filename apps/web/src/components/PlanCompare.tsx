import type { ComparedMeal, DayView, WeekPlanComparison } from "@intake/shared";
import { formatKcal, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

/** Within this many kcal, or 5% of the plan, a difference counts as "in linea". */
const TOLERANCE_KCAL = 30;

/** "▲ +120 kcal", "▼ −80 kcal" or "in linea", with a data attribute for the color (never color alone). */
export function Delta({ planned, actual }: { planned: number; actual: number }) {
  const diff = Math.round(actual - planned);
  const inLine = Math.abs(diff) <= Math.max(TOLERANCE_KCAL, planned * 0.05);
  const kind = inLine ? "ok" : diff > 0 ? "over" : "under";
  const text = inLine ? t.compare.inLine : diff > 0 ? t.compare.over(formatKcal(diff)) : t.compare.under(formatKcal(-diff));
  return (
    <span className="delta" data-kind={kind}>
      {text}
    </span>
  );
}

function mealNote(meal: ComparedMeal): string {
  if (meal.status === "eaten" && meal.planned && meal.logged) return t.compare.plannedEaten(formatKcal(meal.planned.kcal), formatKcal(meal.logged.kcal));
  if (meal.status === "eaten" && meal.logged) return t.compare.eaten(formatKcal(meal.logged.kcal));
  if (meal.status === "free") return meal.logged ? t.compare.freeEaten(formatKcal(meal.logged.kcal)) : t.compare.free;
  if (meal.status === "skipped") return t.compare.skipped;
  if (meal.status === "todo") return t.compare.todo;
  return meal.planned ? t.compare.planned(formatKcal(meal.planned.kcal)) : t.compare.noValues;
}

/** "Piano e realtà" on Oggi: the day so far against the plan, meal by meal. */
export function DayPlanCard({ view }: { view: DayView }) {
  const c = view.comparison;
  if (!c?.plannedDay) return null;
  // "So far": planned meals whose time has passed or that were eaten (the whole day for past days)
  const due = c.meals.filter((m) => m.status === "eaten" || m.status === "todo" || m.status === "skipped");
  const dueKcal = due.reduce((sum, m) => sum + (m.planned?.kcal ?? 0), 0);
  const wholeDay = !view.isToday;

  return (
    <section className="card consistency-card plan-compare" aria-label={t.compare.title}>
      <div className="plan-compare-head">
        <h2>{t.compare.title}</h2>
        <span className="muted">{t.compare.dayPlanned(formatKcal(c.plannedDay.kcal))}</span>
      </div>
      <div className="consistency-row">
        <div>
          <strong>{wholeDay ? t.compare.wholeDay : t.compare.soFar}</strong>
          <span className="muted">{t.compare.plannedEaten(formatKcal(wholeDay ? c.plannedDay.kcal : dueKcal), formatKcal(view.totals.kcal))}</span>
        </div>
        {(due.length > 0 || wholeDay) && <Delta planned={wholeDay ? c.plannedDay.kcal : dueKcal} actual={view.totals.kcal} />}
      </div>
      {c.meals.map((meal, i) => (
        <div key={i} className="consistency-row" data-muted={meal.status === "planned" || undefined}>
          <div>
            <strong>
              {meal.title} · {meal.time}
            </strong>
            <span className="muted">{mealNote(meal)}</span>
          </div>
          {meal.status === "eaten" && meal.planned && meal.logged && <Delta planned={meal.planned.kcal} actual={meal.logged.kcal} />}
        </div>
      ))}
      {c.extras.count > 0 && (
        <div className="consistency-row">
          <div>
            <strong>{t.compare.extras}</strong>
            <span className="muted">{t.compare.extrasNote(c.extras.count, formatKcal(c.extras.kcal))}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** "Piano e realtà" on Settimana: average difference per completed day and the largest deviations. */
export function WeekPlanCard({ plan }: { plan: WeekPlanComparison }) {
  const weekday = (date: string) => formatWeekday(date).slice(0, 3);
  const full = plan.days.filter((d) => !d.hasFreeMeal);
  return (
    <section className="card consistency-card plan-compare" aria-label={t.compare.title}>
      <h2>{t.compare.title}</h2>
      <div className="consistency-row">
        <div>
          <strong>{t.compare.average}</strong>
          <span className="muted">{plan.averageDiff === null ? t.compare.noCompleted : t.compare.averageNote(full.length)}</span>
        </div>
        {plan.averageDiff !== null && <Delta planned={0} actual={plan.averageDiff} />}
      </div>
      {plan.days.map((day) => (
        <div key={day.date} className="consistency-row">
          <div>
            <strong>{formatWeekday(day.date)}</strong>
            <span className="muted">
              {t.compare.plannedEaten(formatKcal(day.planned), formatKcal(day.eaten))}
              {day.hasFreeMeal ? ` · ${t.compare.withFree}` : ""}
            </span>
          </div>
          {!day.hasFreeMeal && <Delta planned={day.planned} actual={day.eaten} />}
        </div>
      ))}
      {plan.deviations.length > 0 && <p className="plan-compare-sub">{t.compare.deviations}</p>}
      {plan.deviations.map((d, i) => (
        <div key={i} className="consistency-row">
          <div>
            <strong>
              {weekday(d.date)} · {d.title}
            </strong>
            <span className="muted">{t.compare.plannedEaten(formatKcal(d.planned), formatKcal(d.logged))}</span>
          </div>
          <Delta planned={d.planned} actual={d.logged} />
        </div>
      ))}
    </section>
  );
}
