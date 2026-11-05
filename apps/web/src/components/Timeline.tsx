import type { Meal } from "@intake/shared";
import { Fragment } from "react";
import { formatGramsShort, formatKcal, formatTime } from "../lib/format";
import { t } from "../lib/strings";
import { MACROS } from "./MacroCard";

interface Props {
  meals: Meal[];
  /** Local time HH:MM:SS when the day is today; the "now" marker is shown only then. */
  now: string | null;
}

function mealTitle(meal: Meal): string {
  return t.mealTypes[meal.type] ?? (meal.type ? meal.type.charAt(0).toUpperCase() + meal.type.slice(1) : "Pasto");
}

/** Foods with quantities when the meal has items, otherwise the description without a "Cena:" prefix. */
function mealSummary(meal: Meal): string {
  if (meal.items.length > 0) {
    return meal.items.map((item) => (item.name.includes(item.quantityText) ? item.name : `${item.name} ${item.quantityText}`)).join(" · ");
  }
  return meal.description.replace(/^[^:]{1,20}:\s*/, "");
}

function MealCard({ meal }: { meal: Meal }) {
  const values = { protein: meal.nutrients.protein, carbs: meal.nutrients.carbs, fat: meal.nutrients.fat, fiber: meal.nutrients.fiber };
  return (
    <article className="meal-card">
      <header className="meal-card-head">
        <h3>{mealTitle(meal)}</h3>
        <span className="meal-kcal">{formatKcal(meal.nutrients.kcal)} kcal</span>
      </header>
      <p className="meal-summary">{mealSummary(meal)}</p>
      {MACROS.some((key) => values[key] !== null && Math.round(values[key]) > 0) && (
        <ul className="chips" aria-label="Macronutrienti del pasto">
          {MACROS.map((key) =>
            // Hide unmeasured and negligible values (e.g. an espresso) to keep the card readable
            values[key] === null || Math.round(values[key]) === 0 ? null : (
              <li key={key} className="chip" data-macro={key}>
                {t.macroChips[key]} {formatGramsShort(values[key])} g
              </li>
            ),
          )}
        </ul>
      )}
    </article>
  );
}

function NowMarker({ time }: { time: string }) {
  return (
    <li className="timeline-item now-marker" aria-label={`${t.timeline.now} ${formatTime(time)}`}>
      <span className="now-time">{formatTime(time)}</span>
      <span className="now-line" aria-hidden="true" />
      <span className="now-label">{t.timeline.now}</span>
    </li>
  );
}

/** Vertical timeline of the day's logged meals, with a "now" marker for today. */
export function Timeline({ meals, now }: Props) {
  const nowHm = now ? formatTime(now) : null;
  const nowIndex = nowHm === null ? -1 : meals.findIndex((meal) => meal.time > nowHm);
  const markerAt = nowHm === null ? -1 : nowIndex === -1 ? meals.length : nowIndex;

  return (
    <section className="timeline-section" aria-label={t.timeline.title}>
      <header className="section-head">
        <h2>{t.timeline.title}</h2>
        <span className="muted">{t.timeline.logged(meals.length)}</span>
      </header>
      {meals.length === 0 && !nowHm && <p className="muted">{t.timeline.empty}</p>}
      <ol className="timeline">
        {meals.map((meal, i) => (
          <Fragment key={meal.id}>
            {i === markerAt && nowHm && <NowMarker time={now!} />}
            <li className="timeline-item" data-kind="logged">
              <time className="timeline-time" dateTime={`${meal.date}T${meal.time}`}>
                {meal.time}
              </time>
              <MealCard meal={meal} />
            </li>
          </Fragment>
        ))}
        {markerAt === meals.length && nowHm && <NowMarker time={now!} />}
      </ol>
      {meals.length === 0 && nowHm && <p className="muted">{t.timeline.empty}</p>}
    </section>
  );
}
