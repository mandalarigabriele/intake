import type { DayView, PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useLogPlanned, useSkipPlanned } from "../api/queries";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** "tra 55 min", "tra 2 h 55 min", or "45 min fa" for a meal whose time has passed. */
export function etaLabel(mealTime: string, now: string): string {
  const diff = minutes(mealTime) - minutes(now);
  const abs = Math.abs(diff);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ""}` : `${abs} min`;
  return diff >= 0 ? t.nextMeal.inTime(text) : t.nextMeal.ago(text);
}

/**
 * The next planned meal of today that is neither logged nor skipped; a passed one that is still to
 * log comes first (docs/design/DESIGN.md, "Today (summary)").
 */
export function nextMeals(planned: PlannedEntry[]): [PlannedEntry | undefined, PlannedEntry | undefined] {
  const open = planned.filter((p) => p.status === "todo" || p.status === "planned").sort((a, b) => a.time.localeCompare(b.time));
  const next = open.find((p) => p.status === "todo") ?? open[0];
  const after = next ? open.find((p) => p !== next && p.time >= next.time) : undefined;
  return [next, after];
}

interface Props {
  view: DayView;
  onAdd: () => void;
}

/** "Prossimo pasto" card on Oggi, with "Mangiato come previsto", "Altro…", "Salta" and "Giornata". */
export function NextMealCard({ view, onAdd }: Props) {
  const logPlanned = useLogPlanned("today");
  const skipPlanned = useSkipPlanned("today");
  const [justSkipped, setJustSkipped] = useState<PlannedEntry | null>(null);

  if (!view.isToday || !view.hasPlan) return null;
  const [next, after] = nextMeals(view.planned);
  if (!next && !justSkipped) return null;

  const now = view.clock.localTime.slice(0, 5);

  return (
    <section className="card next-meal" aria-label={t.nextMeal.label}>
      {justSkipped && (
        <div className="skip-banner">
          <span>{t.nextMeal.skipped(justSkipped.title, justSkipped.time)}</span>
          <button
            type="button"
            onClick={() => {
              skipPlanned.mutate({ date: view.date, planId: justSkipped.planId, index: justSkipped.index, skip: false });
              setJustSkipped(null);
            }}
          >
            {t.timeline.undoSkip}
          </button>
        </div>
      )}

      {next ? (
        <>
          <div className="next-meal-top">
            <span className="next-meal-label">{t.nextMeal.label.toUpperCase()}</span>
            <span className="muted">{etaLabel(next.time, now)}</span>
          </div>
          <div className="next-meal-title">
            <h2>
              {next.title} · {next.time}
            </h2>
            {next.macros && <span className="muted">~{formatKcal(next.macros.kcal)} kcal</span>}
          </div>
          <ul className="next-meal-lines">
            {(next.lines.length > 0 ? next.lines : [next.foods]).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <button
            type="button"
            className="button-primary next-meal-primary"
            disabled={!next.macros || logPlanned.isPending}
            onClick={() => logPlanned.mutate({ date: view.date, planId: next.planId, index: next.index })}
          >
            {t.timeline.eatenAsPlanned}
          </button>
          {!next.macros && <p className="planned-hint">{t.timeline.noMacros}</p>}
          {logPlanned.isError && <p className="error-text">{t.timeline.logFailed}</p>}
          <div className="next-meal-actions">
            <button type="button" className="button-secondary-small" onClick={onAdd}>
              {t.timeline.other}
            </button>
            <button
              type="button"
              className="button-secondary-small"
              onClick={() => {
                skipPlanned.mutate({ date: view.date, planId: next.planId, index: next.index, skip: true });
                setJustSkipped(next);
              }}
            >
              {t.timeline.skip}
            </button>
            <Link href="/timeline" className="button-secondary-small">
              {t.nextMeal.day}
            </Link>
          </div>
          {after && <p className="next-meal-after">{t.nextMeal.then(after.title, after.time, after.foods)}</p>}
        </>
      ) : (
        <p className="muted">{t.nextMeal.none}</p>
      )}
    </section>
  );
}
