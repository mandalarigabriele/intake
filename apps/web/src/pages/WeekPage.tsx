import type { WeekView } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useWeek, useWorkouts } from "../api/queries";
import { addDays } from "../lib/dates";
import { formatGrams, formatKcal, formatShortDate, formatWater, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";
import { WeekPlanCard } from "../components/PlanCompare";
import { WeekWorkoutsCard } from "../components/WorkoutCard";

const CHART_HEIGHT = 140;

/** "2 – 8 novembre" */
function weekRange(start: string, end: string): string {
  const [, , startDay] = start.split("-");
  const endLabel = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${end}T12:00:00Z`));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${Number(startDay)} – ${endLabel}` : `${formatShortDate(start)} – ${endLabel}`;
}

function CaloriesChart({ week, trainingDays }: { week: WeekView; trainingDays: Set<string> }) {
  const goal = week.goals.kcal;
  // The scale leaves room above the goal so days over target stay inside the card (DESIGN.md)
  const max = Math.max((goal ?? 0) * 1.18, ...week.days.map((d) => (d.kcal ?? 0) * 1.05), 1);
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
          const label = `${t.weekdaysLong[i]}: ${day.kcal === null ? t.week.noData : `${formatKcal(day.kcal)} kcal`}${trainingDays.has(day.date) ? ` · ${t.workouts.training}` : ""}`;
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
          <span key={i}>
            {letter}
            {trainingDays.has(week.days[i]!.date) && <span className="training-dot" />}
          </span>
        ))}
      </div>
      {(todayInWeek || empty.length > 0 || trainingDays.size > 0) && (
        <p className="sheet-note">
          {[
            todayInWeek ? t.week.inProgress(formatWeekday(week.today)) : null,
            empty.length > 0 ? t.week.noMeals(empty) : null,
            trainingDays.size > 0 ? t.workouts.trainingDays(week.days.filter((d) => trainingDays.has(d.date)).map((d) => formatWeekday(d.date).toLowerCase())) : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </section>
  );
}

function ConsistencyCard({ week }: { week: WeekView }) {
  const c = week.consistency;
  const weekday = (date: string) => formatWeekday(date).toLowerCase();
  const streakNote =
    c.streak.length === 0 ? t.week.noStreak : c.streak.length <= 3 ? c.streak.map(weekday).join(", ") : t.week.streakSince(weekday(c.streak[0]!), formatShortDate(c.streak[0]!));
  const almost = (value: number, goal: number | null) => (goal && value < goal && value >= goal * 0.85 ? t.week.almost : "");
  const proteinNote = c.protein.best ? `${weekday(c.protein.best.date)} ${formatKcal(c.protein.best.value)} g${almost(c.protein.best.value, c.protein.goal)}` : t.week.noCompletedDays;
  const waterNote =
    c.water.best && c.water.goal
      ? `${weekday(c.water.best.date)} ${formatWater(c.water.best.value)} su ${formatWater(c.water.goal)}${almost(c.water.best.value, c.water.goal)}`
      : t.week.noCompletedDays;
  const rows = [
    { label: t.week.streak, note: streakNote, value: String(c.streak.length), accent: c.streak.length > 0 },
    { label: t.week.proteinTarget, note: proteinNote, value: `${c.protein.hit}/${c.protein.total}` },
    { label: t.week.waterTarget, note: waterNote, value: `${c.water.hit}/${c.water.total}` },
    { label: t.week.asPlanned, note: t.week.asPlannedNote(c.skipped), value: String(c.asPlanned) },
  ];
  return (
    <section className="card consistency-card" aria-label={t.week.consistency}>
      <h2>{t.week.consistency}</h2>
      {rows.map((row) => (
        <div key={row.label} className="consistency-row">
          <div>
            <strong>{row.label}</strong>
            <span className="muted">{row.note}</span>
          </div>
          <span className="consistency-value stat-value" data-accent={row.accent || undefined}>
            {row.value}
          </span>
        </div>
      ))}
    </section>
  );
}

export function WeekPage() {
  const [anchor, setAnchor] = useState<string>("current");
  const week = useWeek(anchor);
  const data = week.data;
  const workouts = useWorkouts(data?.start, data?.end);
  const trainingDays = new Set((workouts.data?.workouts ?? []).map((w) => w.date));
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
          <CaloriesChart week={data} trainingDays={trainingDays} />
          <div className="week-side">
            <div className="stat-tiles">
              <div className="detail-tile">
                <span className="muted">{t.week.avgKcal}</span>
                <strong className="stat-value">{data.averages ? formatKcal(data.averages.kcal) : "–"}</strong>
                <span className="muted tile-note">{t.week.completedDays}</span>
              </div>
              <div className="detail-tile">
                <span className="muted">{t.week.avgProtein}</span>
                <strong className="stat-value">{data.averages ? `${formatGrams(data.averages.protein)} g` : "–"}</strong>
                {data.goals.protein && <span className="muted tile-note">{t.week.proteinGoal(formatKcal(data.goals.protein))}</span>}
              </div>
            </div>
            <ConsistencyCard week={data} />
            {data.plan && <WeekPlanCard plan={data.plan} />}
            {(workouts.isError || (workouts.data && (workouts.data.configured || workouts.data.workouts.length > 0))) && (
              <WeekWorkoutsCard workouts={workouts.data?.workouts ?? []} failed={workouts.isError} partial={workouts.data?.hevyUnavailable === true} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
