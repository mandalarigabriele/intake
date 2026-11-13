import type { WeekView, Workout } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useWeek, useWorkouts } from "../api/queries";
import { WeekPlanCard } from "../components/PlanCompare";
import { TrendsSwitch, TrendsTitle } from "../components/TrendsSwitch";
import { familyIcon } from "../components/WorkoutCard";
import { addDays } from "../lib/dates";
import { formatGrams, formatKcal, formatShortDate, formatWater, formatWeekday, formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";

const CHART_HEIGHT = 140;

/** "2 – 8 novembre" */
function weekRange(start: string, end: string): string {
  const [, , startDay] = start.split("-");
  const endLabel = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${end}T12:00:00Z`));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${Number(startDay)} – ${endLabel}` : `${formatShortDate(start)} – ${endLabel}`;
}

const lower = (date: string) => formatWeekday(date).toLowerCase();

function WorkoutIcon({ family, size, label }: { family: string; size: number; label?: string }) {
  return (
    <svg
      className="week-workout-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      <path d={familyIcon(family)} />
    </svg>
  );
}

/** One icon per workout family and day, in start order. */
function familiesByDay(workouts: Workout[]): Map<string, Workout[]> {
  const days = new Map<string, Workout[]>();
  for (const w of [...workouts].sort((a, b) => a.start.localeCompare(b.start))) {
    const list = days.get(w.date) ?? [];
    if (!list.some((x) => x.family === w.family)) list.push(w);
    days.set(w.date, list);
  }
  return days;
}

/** Share of the macro calories as a stacked bar with labeled percentages (docs/design: kcal share). */
function KcalShare({ share }: { share: NonNullable<NonNullable<WeekView["averages"]>["kcalShare"]> }) {
  const parts = [
    { key: "protein", label: t.week.protein, value: share.protein },
    { key: "carbs", label: t.profile.goalNames.carbs, value: share.carbs },
    { key: "fat", label: t.profile.goalNames.fat, value: share.fat },
  ];
  return (
    <div className="kcal-share">
      <span className="kcal-share-title">{t.week.share}</span>
      <div className="kcal-share-bar" role="img" aria-label={t.week.shareLabel(share.protein, share.carbs, share.fat)}>
        {parts.map((p) => (
          <span key={p.key} data-macro={p.key} style={{ width: `${p.value}%` }} />
        ))}
      </div>
      <div className="kcal-share-legend">
        {parts.map((p) => (
          <span key={p.key} data-macro={p.key}>
            <span className="kcal-share-swatch" aria-hidden="true" />
            {p.label} <strong>{p.value}%</strong>
          </span>
        ))}
      </div>
      <span className="muted kcal-share-note">{t.week.shareNote}</span>
    </div>
  );
}

function CaloriesCard({ week, workouts }: { week: WeekView; workouts: Workout[] }) {
  const goal = week.goals.kcal;
  // The scale leaves room above the goal so days over target stay inside the card (DESIGN.md)
  const max = Math.max((goal ?? 0) * 1.18, ...week.days.map((d) => (d.kcal ?? 0) * 1.05), 1);
  const goalOffset = goal ? CHART_HEIGHT - (goal / max) * CHART_HEIGHT : null;
  const empty = week.days.filter((d) => d.kcal === null && d.date < week.today).map((d) => formatWeekday(d.date));
  const todayInWeek = week.days.some((d) => d.date === week.today);
  const byDay = familiesByDay(workouts);
  // Legend: one entry per workout type seen this week
  const legend = [...new Map(workouts.map((w) => [w.type, w.family])).entries()];
  const notes = [todayInWeek ? t.week.inProgress(formatWeekday(week.today)) : null, empty.length > 0 ? t.week.noMeals(empty) : null].filter(Boolean);
  const share = week.averages?.kcalShare ?? null;

  return (
    <section className="card week-chart nutrition-calories" aria-label={t.week.calories}>
      <div className="week-chart-head">
        <h2>{t.week.calories}</h2>
        {goal && <span className="muted">{t.week.goalLine(formatKcal(goal))}</span>}
      </div>
      <div className="nutrition-calories-body">
        <div className="nutrition-calories-chart">
          <div className="bars" style={{ height: CHART_HEIGHT + 18 }}>
            {goalOffset !== null && <div className="goal-line" style={{ top: goalOffset + 18 }} aria-hidden="true" />}
            {week.days.map((day, i) => {
              const height = day.kcal === null ? 4 : Math.max(4, (day.kcal / max) * CHART_HEIGHT);
              const types = (byDay.get(day.date) ?? []).map((w) => w.type);
              const label = `${t.weekdaysLong[i]}: ${day.kcal === null ? t.week.noData : `${formatKcal(day.kcal)} kcal`}${types.length ? ` · ${types.join(", ")}` : ""}`;
              const href = day.date === week.today ? "/" : `/?d=${day.date}`;
              const bar = (
                <>
                  <span className="bar-value">{day.kcal !== null ? formatKcal(day.kcal) : ""}</span>
                  <span className="bar" data-empty={day.kcal === null || undefined} data-today={day.date === week.today || undefined} style={{ height }} />
                </>
              );
              return day.date > week.today ? (
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
          <div className="bar-labels">
            {week.days.map((day, i) => {
              const marks = byDay.get(day.date) ?? [];
              return (
                <span key={day.date}>
                  <span aria-hidden="true">{t.weekdaysShort[i]}</span>
                  <span className="bar-marks">
                    {marks.slice(0, 2).map((w) => (
                      <WorkoutIcon key={w.family} family={w.family} size={16} label={t.week.workoutOn(formatWeekdayDay(day.date), [w.type])} />
                    ))}
                  </span>
                </span>
              );
            })}
          </div>
          {(notes.length > 0 || legend.length > 0) && (
            <div className="week-legend">
              {notes.map((note) => (
                <span key={note}>{note}</span>
              ))}
              {legend.map(([type, family]) => (
                <span key={type} className="week-legend-item">
                  <WorkoutIcon family={family} size={13} />
                  {type}
                </span>
              ))}
            </div>
          )}
        </div>
        {share && <KcalShare share={share} />}
      </div>
    </section>
  );
}

function Kpi({ label, value, note, accent, wide }: { label: string; value: string; note?: string | null; accent?: boolean; wide?: boolean }) {
  return (
    <div className="detail-tile kpi" data-wide={wide || undefined}>
      <span className="muted">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && (
        <span className="muted tile-note" data-accent={accent || undefined}>
          {note}
        </span>
      )}
    </div>
  );
}

/** KPI row: kcal and protein on phones; fiber, water and logged days join from tablet width (SettimanaDesktop). */
function KpiRow({ week }: { week: WeekView }) {
  const avg = week.averages;
  const { goals, consistency } = week;
  const proteinGap = avg && goals.protein ? goals.protein - avg.protein : null;
  const allLogged = consistency.logged.days.length === consistency.logged.total;
  return (
    <section className="kpi-row" aria-label={t.week.kpi}>
      <Kpi
        label={t.week.avgKcal}
        value={avg ? t.week.avgKcalUnit(formatKcal(avg.kcal)) : "–"}
        note={avg ? [t.week.completedDays(avg.days), goals.kcal ? t.week.goalNote(formatKcal(goals.kcal)) : null].filter(Boolean).join(" · ") : null}
      />
      <Kpi
        label={t.week.avgProtein}
        value={avg ? `${formatGrams(avg.protein)} g` : "–"}
        note={proteinGap === null ? null : proteinGap > 0 ? t.week.fromGoal(formatGrams(proteinGap)) : t.week.overGoal}
      />
      <Kpi
        wide
        label={t.week.avgFiber}
        value={avg?.fiber != null ? `${formatGrams(avg.fiber)} g` : "–"}
        note={goals.fiber && consistency.fiber.total > 0 ? t.week.daysAtGoal(`${formatKcal(goals.fiber)} g`, consistency.fiber.hit, consistency.fiber.total) : null}
        accent={consistency.fiber.total > 0 && consistency.fiber.hit === consistency.fiber.total}
      />
      <Kpi wide label={t.week.avgWater} value={avg ? formatWater(avg.waterMl) : "–"} note={goals.waterMl ? t.week.goalNote(formatWater(goals.waterMl)) : null} />
      <Kpi
        wide
        label={t.week.loggedDays}
        value={`${consistency.logged.days.length}/${consistency.logged.total}`}
        note={consistency.logged.total > 0 && allLogged ? t.week.allLogged : null}
        accent={allLogged && consistency.logged.total > 0}
      />
    </section>
  );
}

/** Protein per day against the goal line; today lighter, future days as placeholders. */
function ProteinCard({ week }: { week: WeekView }) {
  const goal = week.goals.protein;
  const W = 326;
  const H = 150;
  const base = 116;
  const top = 18;
  const max = Math.max((goal ?? 0) * 1.15, ...week.days.map((d) => d.protein ?? 0), 1);
  const y = (v: number) => base - (v / max) * (base - top);
  const step = (W - 8) / 7;
  const barWidth = step * 0.72;
  const hit = week.days.filter((d) => goal && d.protein !== null && d.protein >= goal && d.date < week.today).map((d) => lower(d.date));
  const goalLabel = goal ? formatKcal(goal) : null;
  const note = [hit.length > 0 ? t.week.proteinHit(hit) : goal ? t.week.proteinNoHit : null, week.days.some((d) => d.date === week.today) ? t.week.inProgress(lower(week.today)) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="card week-chart nutrition-protein" aria-label={t.week.protein}>
      <div className="week-chart-head">
        <h2>{t.week.protein}</h2>
        <span className="muted">{t.week.proteinHead(goalLabel)}</span>
      </div>
      <svg className="protein-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.week.proteinChart(goalLabel)}>
        {goal && (
          <>
            <line className="protein-goal" x1="4" x2={W - 4} y1={y(goal)} y2={y(goal)} />
            <text className="protein-goal-label" x={W - 4} y={y(goal) - 4} textAnchor="end">
              {`${goalLabel} g`}
            </text>
          </>
        )}
        {week.days.map((day, i) => {
          const cx = 4 + step * i + step / 2;
          return (
            <g key={day.date}>
              <text className="protein-day" x={cx} y={130} textAnchor="middle">
                {t.weekdaysShort[i]}
              </text>
              {day.protein === null ? (
                <rect className="protein-empty" x={cx - barWidth / 2} y={base - 3} width={barWidth} height={3} rx="1.5" />
              ) : (
                <>
                  <rect
                    className="protein-bar"
                    data-today={day.date === week.today || undefined}
                    x={cx - barWidth / 2}
                    y={y(day.protein)}
                    width={barWidth}
                    height={Math.max(2, base - y(day.protein))}
                    rx="4"
                  >
                    <title>{t.week.proteinPoint(formatWeekdayDay(day.date), formatGrams(day.protein))}</title>
                  </rect>
                  <text className="protein-value" x={cx} y={144} textAnchor="middle">
                    {formatKcal(day.protein)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {note && <span className="muted protein-note">{note}</span>}
    </section>
  );
}

function ConsistencyCard({ week }: { week: WeekView }) {
  const c = week.consistency;
  const almost = (value: number, goal: number | null) => (goal && value < goal && value >= goal * 0.85 ? t.week.almost : "");
  const targetNote = (target: WeekView["consistency"]["protein"], format: (v: number) => string) =>
    target.best ? `${lower(target.best.date)} ${format(target.best.value)}${almost(target.best.value, target.goal)}` : t.week.noCompletedDays;
  const missing = week.days.filter((d) => d.date <= week.today && !c.logged.days.includes(d.date)).map((d) => lower(d.date));
  const allLogged = c.logged.total > 0 && missing.length === 0;
  const rows = [
    { label: t.week.loggedDays, note: allLogged ? t.week.allLogged : t.week.missing(missing), value: `${c.logged.days.length}/${c.logged.total}`, accent: allLogged },
    { label: t.week.proteinTarget, note: targetNote(c.protein, (v) => `${formatKcal(v)} g`), value: `${c.protein.hit}/${c.protein.total}` },
    ...(c.fiber.goal ? [{ label: t.week.fiberTarget, note: targetNote(c.fiber, (v) => `${formatKcal(v)} g`), value: `${c.fiber.hit}/${c.fiber.total}` }] : []),
    {
      label: t.week.waterTarget,
      note: c.water.best && c.water.goal ? `${lower(c.water.best.date)} ${formatWater(c.water.best.value)} su ${formatWater(c.water.goal)}${almost(c.water.best.value, c.water.goal)}` : t.week.noCompletedDays,
      value: `${c.water.hit}/${c.water.total}`,
    },
    { label: t.week.asPlanned, note: t.week.asPlannedNote(c.skipped), value: String(c.asPlanned) },
  ];
  return (
    <section className="card consistency-card nutrition-consistency" aria-label={t.week.consistency}>
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

/** Andamento › Alimentazione (docs/design Settimana, SettimanaDesktop): nutrition only, with workout marks. */
export function WeekPage() {
  const [anchor, setAnchor] = useState<string>("current");
  const week = useWeek(anchor);
  const data = week.data;
  const workouts = useWorkouts(data?.start, data?.end);
  const isCurrent = data ? data.today >= data.start && data.today <= data.end : true;

  return (
    <div className="page section-page week-page">
      <header className="section-header">
        <div className="page-heading">
          <p className="page-date">{data ? weekRange(data.start, data.end) : " "}</p>
          <TrendsTitle page={t.week.title} />
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
      <TrendsSwitch current="nutrition" />

      {week.isPending && <div className="card skeleton" style={{ height: 260 }} />}

      {data && (
        <div className="nutrition-layout" aria-busy={week.isFetching}>
          <KpiRow week={data} />
          <div className="nutrition-grid">
            <CaloriesCard week={data} workouts={workouts.data?.workouts ?? []} />
            <ProteinCard week={data} />
            <ConsistencyCard week={data} />
            {data.plan && <WeekPlanCard plan={data.plan} />}
          </div>
        </div>
      )}
    </div>
  );
}
