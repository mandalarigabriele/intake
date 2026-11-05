import type { Meal } from "@intake/shared";
import { formatGramsShort, formatKcal, formatTime } from "../lib/format";
import { t } from "../lib/strings";
import { MACROS } from "./MacroCard";

interface Props {
  meals: Meal[];
  /** Local time HH:MM:SS when the day is today; the "now" marker is shown only then. */
  now: string | null;
}

type Entry = { kind: "meal"; meal: Meal } | { kind: "now"; time: string };

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
  const chips = MACROS.filter((key) => values[key] !== null && Math.round(values[key]) > 0);
  return (
    <article className="meal-card">
      <header className="meal-card-head">
        <h3>{mealTitle(meal)}</h3>
        <span className="meal-kcal">{formatKcal(meal.nutrients.kcal)} kcal</span>
      </header>
      <p className="meal-summary">{mealSummary(meal)}</p>
      {chips.length > 0 && (
        <ul className="chips" aria-label="Macronutrienti del pasto">
          {chips.map((key) => (
            <li key={key} className="chip" data-macro={key}>
              {t.macroChips[key]} {formatGramsShort(values[key]!)} g
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * Vertical timeline of the day. A continuous rod runs behind the time labels:
 * solid accent up to the "now" marker, dashed grey after it.
 */
export function Timeline({ meals, now }: Props) {
  const nowHm = now ? formatTime(now) : null;
  const entries: Entry[] = meals.map((meal) => ({ kind: "meal", meal }));
  if (nowHm) {
    const index = meals.findIndex((meal) => meal.time > nowHm);
    entries.splice(index === -1 ? entries.length : index, 0, { kind: "now", time: nowHm });
  }
  const nowIndex = entries.findIndex((entry) => entry.kind === "now");

  return (
    <section className="timeline-section" aria-label={t.timeline.title}>
      <header className="section-head">
        <h2>{t.timeline.title}</h2>
        <span className="muted">{t.timeline.logged(meals.length)}</span>
      </header>
      {meals.length === 0 && <p className="muted timeline-empty">{t.timeline.empty}</p>}
      <ol className="timeline">
        {entries.map((entry, i) => {
          const rod = nowIndex === -1 || i < nowIndex ? "past" : "future";
          const position = entries.length === 1 ? "only" : i === 0 ? "first" : i === entries.length - 1 ? "last" : undefined;
          if (entry.kind === "now") {
            return (
              <li key="now" className="timeline-item now-marker" data-rod="future" data-position={position} aria-label={`${t.timeline.nowLabel} ${entry.time}`}>
                <span className="timeline-gutter">
                  <span className="now-time">{entry.time}</span>
                </span>
                <span className="now-line" aria-hidden="true" />
                <span className="now-label" aria-hidden="true">
                  {t.timeline.now}
                </span>
              </li>
            );
          }
          const { meal } = entry;
          return (
            <li key={meal.id} className="timeline-item" data-rod={rod} data-position={position}>
              <span className="timeline-gutter">
                <time className="timeline-time" dateTime={`${meal.date}T${meal.time}`}>
                  {meal.time}
                </time>
              </span>
              <MealCard meal={meal} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
