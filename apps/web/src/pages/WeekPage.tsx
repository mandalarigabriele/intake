import type { WeekView } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useLogWeight, useWeek } from "../api/queries";
import { addDays } from "../lib/dates";
import { formatGrams, formatKcal, formatShortDate, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

const CHART_HEIGHT = 140;

/** "2 – 8 novembre" */
function weekRange(start: string, end: string): string {
  const [, , startDay] = start.split("-");
  const endLabel = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${end}T12:00:00Z`));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${Number(startDay)} – ${endLabel}` : `${formatShortDate(start)} – ${endLabel}`;
}

function CaloriesChart({ week }: { week: WeekView }) {
  const goal = week.goals.kcal;
  const max = Math.max(goal ?? 0, ...week.days.map((d) => d.kcal ?? 0), 1);
  const goalOffset = goal ? CHART_HEIGHT - (goal / max) * CHART_HEIGHT : null;
  const empty = week.days.filter((d) => d.kcal === null && d.date < week.today).map((d) => formatWeekday(d.date));
  const todayInWeek = week.days.find((d) => d.date === week.today);

  return (
    <section className="card week-chart" aria-label={t.week.calories}>
      <div className="week-chart-head">
        <h2>{t.week.calories}</h2>
        {goal && <span className="muted">{t.week.goalLine(formatKcal(goal))}</span>}
      </div>
      <div className="bars" style={{ height: CHART_HEIGHT + 18 }}>
        {goalOffset !== null && <div className="goal-line" style={{ top: goalOffset + 18 }} aria-hidden="true" />}
        {week.days.map((day, i) => {
          const height = day.kcal === null ? 4 : Math.max(4, (day.kcal / max) * CHART_HEIGHT);
          const label = `${t.weekdaysLong[i]}: ${day.kcal === null ? t.week.noData : `${formatKcal(day.kcal)} kcal`}`;
          const href = day.date === week.today ? "/" : `/?d=${day.date}`;
          const future = day.date > week.today;
          const bar = (
            <>
              <span className="bar-value">{day.kcal !== null ? formatKcal(day.kcal) : ""}</span>
              <span className="bar" data-empty={day.kcal === null || undefined} data-today={day.date === week.today || undefined} style={{ height }} />
            </>
          );
          return future ? (
            <span key={day.date} className="bar-column" aria-label={label}>
              {bar}
            </span>
          ) : (
            <Link key={day.date} href={href} className="bar-column" aria-label={`${t.week.openDay(t.weekdaysLong[i]!)} · ${label}`} title={label}>
              {bar}
            </Link>
          );
        })}
      </div>
      <div className="bar-labels" aria-hidden="true">
        {t.weekdaysShort.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
      {(todayInWeek || empty.length > 0) && (
        <p className="sheet-note">
          {[todayInWeek ? t.week.inProgress(formatWeekday(week.today)) : null, empty.length > 0 ? t.week.noMeals(empty) : null].filter(Boolean).join(" ")}
        </p>
      )}
    </section>
  );
}

function WeightCard({ week }: { week: WeekView }) {
  const log = useLogWeight();
  const [value, setValue] = useState("");
  const entries = week.weight.entries;
  const latest = entries.at(-1);
  const previous = entries.at(-2);
  const delta = latest && previous ? latest.weight - previous.weight : null;
  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 20 && parsed <= 400;

  return (
    <section className="card weight-card" aria-label={t.week.weight}>
      <div className="week-chart-head">
        <h2>{t.week.weight}</h2>
        <span className="muted">{t.week.weightCadence}</span>
      </div>
      {latest ? (
        <div className="weight-latest">
          <strong className="stat-value">
            {formatGrams(latest.weight)} <span>{week.weight.unit}</span>
          </strong>
          <span className="muted">
            {delta !== null
              ? t.week.change(`${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${formatGrams(Math.abs(delta))}`, formatShortDate(previous!.date))
              : `${t.week.weighedOn(formatShortDate(latest.date))} · ${t.week.oneWeight}`}
            {week.weight.target !== null && ` · ${t.week.target(formatGrams(week.weight.target))}`}
          </span>
        </div>
      ) : (
        <p className="sheet-note">{t.week.noWeight}</p>
      )}
      <form
        className="weight-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) log.mutate(Math.round(parsed * 10) / 10, { onSuccess: () => setValue("") });
        }}
      >
        <label className="weight-input">
          <span className="visually-hidden">{t.week.weightLabel}</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={t.week.weightPlaceholder} aria-label={t.week.weightLabel} />
          <span className="muted">kg</span>
        </label>
        <button type="submit" className="button" disabled={!valid || log.isPending}>
          {t.week.log}
        </button>
      </form>
      {log.isSuccess && <p className="notice" data-kind="ok">{t.week.logged}</p>}
      {log.isError && <p className="error-text">{t.week.logFailed}</p>}
    </section>
  );
}

export function WeekPage() {
  const [anchor, setAnchor] = useState<string>("current");
  const week = useWeek(anchor);
  const data = week.data;
  const isCurrent = data ? data.today >= data.start && data.today <= data.end : true;

  return (
    <div className="page section-page week-page">
      <header className="section-header">
        <div className="page-heading">
          <p className="page-date">{data ? weekRange(data.start, data.end) : " "}</p>
          <h1 className="page-title">{t.week.title}</h1>
        </div>
        <div className="week-nav">
          <button type="button" className="icon-button" aria-label={t.week.previous} disabled={!data} onClick={() => data && setAnchor(addDays(data.start, -7))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button type="button" className="icon-button" aria-label={t.week.next} disabled={!data || isCurrent} onClick={() => data && setAnchor(addDays(data.start, 7))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>

      {week.isPending && <div className="card skeleton" style={{ height: 260 }} />}

      {data && (
        <div className="week-layout" aria-busy={week.isFetching}>
          <CaloriesChart week={data} />
          <div className="week-side">
            <div className="stat-tiles">
              <div className="detail-tile">
                <span className="muted">{t.week.avgKcal}</span>
                <strong className="stat-value">{data.averages ? formatKcal(data.averages.kcal) : "–"}</strong>
                {data.averages && <span className="muted tile-note">{t.week.onLoggedDays(data.averages.days)}</span>}
              </div>
              <div className="detail-tile">
                <span className="muted">{t.week.avgProtein}</span>
                <strong className="stat-value">{data.averages ? `${formatGrams(data.averages.protein)} g` : "–"}</strong>
                {data.goals.protein && <span className="muted tile-note">{t.week.proteinGoal(formatKcal(data.goals.protein))}</span>}
              </div>
            </div>
            <WeightCard week={data} />
          </div>
        </div>
      )}
    </div>
  );
}
