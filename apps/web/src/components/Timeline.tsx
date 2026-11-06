import type { Meal, PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { ConfirmDeleteSheet } from "./ConfirmDeleteSheet";
import { formatGramsShort, formatKcal, formatTime } from "../lib/format";
import { t } from "../lib/strings";
import { MACROS } from "./MacroCard";

interface Props {
  date: string;
  meals: Meal[];
  planned: PlannedEntry[];
  hasPlan: boolean;
  /** Show the "Timeline" heading (off on the Timeline page, whose title already says it). */
  heading?: boolean;
  /** Local time HH:MM:SS when the day is today; the "now" marker is shown only then. */
  now: string | null;
  onLogPlanned: (entry: PlannedEntry) => void;
  /** Skip (true) or restore (false) a planned meal. */
  onSkipPlanned: (entry: PlannedEntry, skip: boolean) => void;
  loggingPlanned: PlannedEntry | null;
  logFailed: boolean;
  onOther: () => void;
}

type Entry = { kind: "meal"; time: string; meal: Meal } | { kind: "planned"; time: string; entry: PlannedEntry } | { kind: "now"; time: string };

export function mealTitle(meal: Pick<Meal, "type">): string {
  return t.mealTypes[meal.type] ?? (meal.type ? meal.type.charAt(0).toUpperCase() + meal.type.slice(1) : "Pasto");
}

/** Foods with quantities when the meal has items, otherwise the description without a "Cena:" prefix. */
export function mealSummary(meal: Meal): string {
  if (meal.items.length > 0) {
    return meal.items.map((item) => (item.name.includes(item.quantityText) ? item.name : `${item.name} ${item.quantityText}`)).join(" · ");
  }
  return meal.description.replace(/^[^:]{1,20}:\s*/, "");
}

/** Planned meal text without a leading "Pranzo in famiglia:" that repeats the title. */
const plannedText = (entry: PlannedEntry) => entry.foods.replace(/^[^:]{1,30}:\s*/, (prefix) => (prefix.toLowerCase().startsWith(entry.title.toLowerCase().slice(0, 5)) ? "" : prefix));

function LoggedCard({ meal }: { meal: Meal }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const values = { protein: meal.nutrients.protein, carbs: meal.nutrients.carbs, fat: meal.nutrients.fat, fiber: meal.nutrients.fiber };
  const chips = MACROS.filter((key) => values[key] !== null && Math.round(values[key]) > 0);
  const title = mealTitle(meal);
  return (
    <article className="meal-card" data-kind="logged">
      <header className="meal-card-head">
        <h3>
          {/* The link covers the whole card; the edit/delete buttons sit above it */}
          <Link href={`/pasto/${meal.date}/${meal.id}`} className="card-link">
            {title}
          </Link>
        </h3>
        <span className="meal-kcal">{formatKcal(meal.nutrients.kcal)} kcal</span>
        <span className="card-tools">
          <Link href={`/pasto/${meal.date}/${meal.id}/modifica`} className="tool-button" aria-label={`${t.meal.edit} ${title.toLowerCase()}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
          </Link>
          <button type="button" className="tool-button" data-danger aria-label={`${t.edit.delete} ${title.toLowerCase()}`} onClick={() => setConfirmDelete(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
            </svg>
          </button>
        </span>
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
      {confirmDelete && (
        <ConfirmDeleteSheet mealId={meal.id} mealType={meal.type} onClose={() => setConfirmDelete(false)} onDeleted={() => setConfirmDelete(false)} />
      )}
    </article>
  );
}

function PlannedCard({
  entry,
  onLog,
  onSkip,
  logging,
  failed,
  onOther,
}: {
  entry: PlannedEntry;
  onLog: () => void;
  onSkip: (skip: boolean) => void;
  logging: boolean;
  failed: boolean;
  onOther: () => void;
}) {
  if (entry.status === "skipped") {
    return (
      <article className="meal-card" data-kind="skipped">
        <header className="meal-card-head">
          <h3>{entry.title}</h3>
          <span className="planned-label">{t.timeline.skipped}</span>
        </header>
        <button type="button" className="text-button text-button-strong undo-skip" onClick={() => onSkip(false)}>
          {t.timeline.undoSkip}
        </button>
      </article>
    );
  }

  const label = entry.status === "todo" ? t.timeline.todo : entry.status === "free" ? t.timeline.free : t.timeline.planned;
  return (
    <article className="meal-card" data-kind={entry.status}>
      <header className="meal-card-head">
        <h3>{entry.title}</h3>
        <span className="planned-label">{label}</span>
      </header>
      {entry.foods && <p className="meal-summary">{plannedText(entry)}</p>}
      {entry.status === "todo" && (
        <>
          <div className="planned-actions">
            <button type="button" className="button-small button-inverse" onClick={onLog} disabled={logging || !entry.macros}>
              {t.timeline.eatenAsPlanned}
            </button>
            <button type="button" className="button-small button-outline" onClick={onOther}>
              {t.timeline.other}
            </button>
            <button type="button" className="button-small button-ghost" onClick={() => onSkip(true)}>
              {t.timeline.skip}
            </button>
          </div>
          {!entry.macros && <p className="planned-hint">{t.timeline.noMacros}</p>}
          {failed && <p className="error-text">{t.timeline.logFailed}</p>}
        </>
      )}
      {entry.status === "planned" && (
        <button type="button" className="text-button skip-upcoming" onClick={() => onSkip(true)}>
          {t.timeline.skip}
        </button>
      )}
    </article>
  );
}

/**
 * Vertical timeline of the day: logged meals, planned meals from the active plan and, for today,
 * the "now" marker. A continuous rod runs behind the time labels: solid until now, dashed after.
 */
export function Timeline({ meals, planned, hasPlan, heading = true, now, onLogPlanned, onSkipPlanned, loggingPlanned, logFailed, onOther }: Props) {
  const entries: Entry[] = [
    ...meals.map((meal): Entry => ({ kind: "meal", time: meal.time, meal })),
    ...planned.map((entry): Entry => ({ kind: "planned", time: entry.time, entry })),
  ].sort((a, b) => a.time.localeCompare(b.time) || (a.kind === "meal" ? -1 : 1));

  const nowHm = now ? formatTime(now) : null;
  if (nowHm) {
    const index = entries.findIndex((entry) => entry.time > nowHm);
    entries.splice(index === -1 ? entries.length : index, 0, { kind: "now", time: nowHm });
  }
  const nowIndex = entries.findIndex((entry) => entry.kind === "now");

  const todo = planned.filter((p) => p.status === "todo").length;
  const upcoming = planned.filter((p) => p.status === "planned" || p.status === "free").length;
  const skipped = planned.filter((p) => p.status === "skipped").length;
  const counts = [
    t.timeline.logged(meals.length),
    todo > 0 ? t.timeline.todoCount(todo) : upcoming > 0 ? t.timeline.plannedCount(upcoming) : null,
    skipped > 0 ? t.timeline.skippedCount(skipped) : null,
  ];

  return (
    <section className="timeline-section" aria-label={t.timeline.title}>
      <header className="section-head">
        {heading && <h2>{t.timeline.title}</h2>}
        <span className="muted">{counts.filter(Boolean).join(" · ")}</span>
      </header>
      {meals.length === 0 && planned.length === 0 && <p className="muted timeline-empty">{t.timeline.empty}</p>}
      {!hasPlan && (
        <p className="timeline-hint">
          {t.timeline.noPlan}{" "}
          <Link href="/piano">{t.timeline.uploadPlan}</Link>
        </p>
      )}
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

          const key = entry.kind === "meal" ? entry.meal.id : `plan-${entry.entry.planId}-${entry.entry.index}`;
          const upcomingPlan = entry.kind === "planned" && entry.entry.status !== "todo";
          return (
            <li key={key} className="timeline-item" data-rod={rod} data-position={position}>
              <span className="timeline-gutter">
                <time className="timeline-time" data-upcoming={upcomingPlan || undefined}>
                  {entry.time}
                </time>
              </span>
              {entry.kind === "meal" ? (
                <LoggedCard meal={entry.meal} />
              ) : (
                <PlannedCard
                  entry={entry.entry}
                  onLog={() => onLogPlanned(entry.entry)}
                  onSkip={(skip) => onSkipPlanned(entry.entry, skip)}
                  logging={loggingPlanned?.planId === entry.entry.planId && loggingPlanned.index === entry.entry.index}
                  failed={logFailed && loggingPlanned?.planId === entry.entry.planId && loggingPlanned.index === entry.entry.index}
                  onOther={onOther}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
