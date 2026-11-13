import type { HealthTrendDay, HealthTrends, Workout } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useHealthTrends, useWorkouts } from "../api/queries";
import { TrendsSwitch, TrendsTitle } from "../components/TrendsSwitch";
import { formatDayLongMonth, formatDurationShort, formatKcal, formatOneDecimal, formatShortDate, formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";

type Period = 7 | 30 | 90;
type Tab = "sleep" | "activity" | "heart";
const PERIODS: Period[] = [7, 30, 90];
const TABS: Tab[] = ["sleep", "activity", "heart"];

const LETTERS = ["D", "L", "M", "M", "G", "V", "S"];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** x-axis label: the weekday letter over 7 days, Mondays as "d/m" over 30 days, the first Monday of each month over 90. */
function axisLabel(date: string, period: Period): string {
  if (period === 7) return LETTERS[weekdayOf(date)]!;
  const day = Number(date.slice(8, 10));
  if (weekdayOf(date) !== 1 || (period === 90 && day > 7)) return "";
  return `${day}/${Number(date.slice(5, 7))}`;
}

/** "23:50" from minutes relative to midnight (negative = the evening before). */
function clock(minutes: number): string {
  const v = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

const dayLabel = (date: string) => `${formatWeekdayDay(date)} ${formatShortDate(date).split(" ")[1] ?? ""}`.trim();

function Tile({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className="detail-tile trend-tile">
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

function CardHead({ title, source }: { title: string; source?: string | null }) {
  return (
    <div className="week-chart-head">
      <h2>{title}</h2>
      {source && <span className="source-pill">{source}</span>}
    </div>
  );
}

function DayLabels({ days, period }: { days: HealthTrendDay[]; period: Period }) {
  return (
    <div className="trend-labels" data-period={period} aria-hidden="true">
      {days.map((d) => (
        <span key={d.date}>
          <span>{axisLabel(d.date, period)}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sonno

function SleepSection({ data }: { data: HealthTrends }) {
  const sleep = data.sleep;
  if (!sleep) return <p className="card trend-empty muted">{t.trends.noData}</p>;
  const nights = data.days.flatMap((d) => (d.sleep ? [d.sleep] : []));
  // Default window 22:00 → 09:30, widened when a night falls outside it
  const t0 = Math.min(-120, ...nights.map((n) => n.start)) - 10;
  const t1 = Math.max(570, ...nights.map((n) => n.end)) + 10;
  const pos = (m: number) => ((m - t0) / (t1 - t0)) * 100;
  const ticks = [-60, 120, 300, 480].filter((m) => m > t0 && m < t1);
  const phases = [
    { key: "deep", value: sleep.phases.deep },
    { key: "rem", value: sleep.phases.rem },
    { key: "core", value: sleep.phases.core },
    { key: "awake", value: sleep.phases.awake },
  ] as const;
  const total = phases.reduce((s, p) => s + p.value, 0) || 1;
  const pct = (v: number) => Math.round((v / total) * 100);

  return (
    <>
      <div className="trend-tiles">
        <Tile label={t.trends.avgSleep} value={formatDurationShort(sleep.averageAsleep)} note={t.trends.nights(sleep.nights)} />
        <Tile label={t.trends.fallAsleep} value={clock(sleep.averageStart)} note={t.trends.meanTime} />
        <Tile label={t.trends.wakeUp} value={clock(sleep.averageEnd)} note={t.trends.meanTime} />
      </div>

      <section className="card week-chart" aria-label={t.trends.sleepTimes}>
        <CardHead title={t.trends.sleepTimes} source={data.source} />
        <div className="sleep-chart">
          <div className="sleep-ticks" aria-hidden="true">
            {ticks.map((m) => (
              <span key={m} style={{ top: `${pos(m)}%` }}>
                {clock(m)}
              </span>
            ))}
          </div>
          <div className="sleep-plot-wrap">
            <div className="sleep-plot trend-columns" data-period={data.period} role="img" aria-label={t.trends.sleepTimesAria(data.period)}>
              {ticks.map((m) => (
                <span key={m} className="sleep-grid" style={{ top: `${pos(m)}%` }} aria-hidden="true" />
              ))}
              {data.days.map((d) => (
                <span key={d.date} className="trend-column">
                  {d.sleep && (
                    <span
                      className="sleep-range"
                      data-shortest={d.date === sleep.shortest.date || undefined}
                      style={{ top: `${pos(d.sleep.start)}%`, height: `${pos(d.sleep.end) - pos(d.sleep.start)}%` }}
                      title={t.trends.sleepBar(dayLabel(d.date), clock(d.sleep.start), clock(d.sleep.end), formatDurationShort(d.sleep.asleep))}
                    />
                  )}
                </span>
              ))}
            </div>
            <DayLabels days={data.days} period={data.period} />
          </div>
        </div>
        <div className="week-legend">
          <span className="week-legend-item">
            <span className="legend-swatch" data-kind="sleep" aria-hidden="true" />
            {t.trends.sleepLegend}
          </span>
          <span className="week-legend-item">
            <span className="legend-swatch" data-kind="shortest" aria-hidden="true" />
            {t.trends.shortest(formatShortDate(sleep.shortest.date), formatDurationShort(sleep.shortest.minutes))}
          </span>
        </div>
      </section>

      <section className="card week-chart" aria-label={t.trends.phases}>
        <CardHead title={t.trends.phases} />
        <div className="phase-bar" role="img" aria-label={t.trends.phasesAria(phases.map((p) => `${t.trends.phaseNames[p.key]} ${pct(p.value)}%`).join(", "))}>
          {phases.map((p) => (
            <span key={p.key} data-phase={p.key} style={{ width: `${(p.value / total) * 100}%` }} />
          ))}
        </div>
        <div className="phase-legend">
          {phases.map((p) => (
            <span key={p.key} data-phase={p.key}>
              <span className="phase-swatch" aria-hidden="true" />
              {t.trends.phaseNames[p.key]} <strong>{p.key === "awake" ? `${p.value} min` : formatDurationShort(p.value)}</strong> <span className="muted">{pct(p.value)}%</span>
            </span>
          ))}
        </div>
        <dl className="trend-facts">
          <div>
            <dt>{t.trends.under7h}</dt>
            <dd>{t.trends.outOf(sleep.under7h, sleep.nights)}</dd>
          </div>
          <div>
            <dt>{t.trends.afterMidnight}</dt>
            <dd>{t.trends.outOf(sleep.afterMidnight, sleep.nights)}</dd>
          </div>
          <div>
            <dt>{t.trends.longest}</dt>
            <dd>{`${formatShortDate(sleep.longest.date)} · ${formatDurationShort(sleep.longest.minutes)}`}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Attività

function byType(workouts: Workout[]) {
  const types = new Map<string, { count: number; minutes: number; hr: number[] }>();
  for (const w of workouts) {
    const entry = types.get(w.type) ?? { count: 0, minutes: 0, hr: [] };
    entry.count += 1;
    entry.minutes += w.durationMinutes;
    if (w.hrAvg !== null) entry.hr.push(w.hrAvg);
    types.set(w.type, entry);
  }
  return [...types.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
}

function ActivitySection({ data, workouts }: { data: HealthTrends; workouts: Workout[] }) {
  const steps = data.steps;
  const goal = data.stepGoal;
  const max = Math.max(goal * 1.12, ...data.days.map((d) => d.steps ?? 0), 1);
  const minutes = workouts.reduce((s, w) => s + w.durationMinutes, 0);
  const types = byType(workouts);
  const maxMinutes = types[0]?.[1].minutes ?? 1;
  const recent = [...workouts].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, 4);

  return (
    <>
      <div className="trend-tiles">
        <Tile label={t.trends.avgSteps} value={steps ? formatKcal(steps.average) : "–"} note={steps ? t.trends.finishedDays(steps.days) : undefined} />
        <Tile label={t.trends.daysAtGoal(formatKcal(goal))} value={steps ? String(steps.atGoal) : "–"} note={steps ? t.trends.ofDays(steps.days) : undefined} />
        <Tile label={t.trends.workouts} value={String(workouts.length)} note={workouts.length ? t.trends.totalTime(formatDurationShort(minutes)) : undefined} />
      </div>

      <section className="card week-chart" aria-label={t.trends.stepsPerDay}>
        <CardHead title={t.trends.stepsPerDay} source={data.source} />
        <div className="steps-plot-wrap">
          <span className="steps-goal" style={{ bottom: `${(goal / max) * 100}%` }} aria-hidden="true">
            <span>{t.trends.goalLine(formatKcal(goal))}</span>
          </span>
          <div className="steps-plot trend-columns" data-period={data.period} role="img" aria-label={t.trends.stepsAria(data.period)}>
            {data.days.map((d) => (
              <span key={d.date} className="trend-column">
                <span
                  className="steps-bar"
                  data-empty={d.steps === null || undefined}
                  data-today={d.date === data.today || undefined}
                  style={{ height: d.steps === null ? "2px" : `${Math.max(1.5, (d.steps / max) * 100)}%` }}
                  title={d.steps === null ? t.trends.noNight(dayLabel(d.date)) : t.trends.stepsBar(dayLabel(d.date), formatKcal(d.steps), d.date === data.today)}
                />
              </span>
            ))}
          </div>
        </div>
        <DayLabels days={data.days} period={data.period} />
        <span className="muted trend-note">{[steps ? t.trends.bestDay(dayLabel(steps.best.date), formatKcal(steps.best.steps)) : null, t.trends.todayLight].filter(Boolean).join(" · ")}</span>
      </section>

      <section className="card week-chart" aria-label={t.trends.byType}>
        <div className="week-chart-head">
          <h2>{t.trends.byType}</h2>
          {workouts.length > 0 && <span className="muted">{`${t.trends.sessions(workouts.length)} · ${formatDurationShort(minutes)}`}</span>}
        </div>
        {types.length === 0 && <span className="muted trend-note">{t.trends.noWorkouts}</span>}
        {types.map(([type, v]) => (
          <div key={type} className="type-row">
            <div className="type-row-head">
              <strong>{type}</strong>
              <span className="muted">{`${t.trends.sessions(v.count)} · ${formatDurationShort(v.minutes)}`}</span>
            </div>
            <div className="type-track">
              <span style={{ width: `${(v.minutes / maxMinutes) * 100}%` }} />
            </div>
          </div>
        ))}
      </section>

      {recent.length > 0 && (
        <section className="card consistency-card" aria-label={t.trends.recent}>
          <h2>{t.trends.recent}</h2>
          {recent.map((w) => {
            const meta = [
              dayLabel(w.date).toLowerCase(),
              w.start,
              `${w.durationMinutes} min`,
              w.distanceKm !== null ? `${formatOneDecimal(w.distanceKm)} km` : null,
              w.kcal !== null ? `${formatKcal(w.kcal)} kcal` : null,
              w.hrAvg !== null ? `FC ${formatKcal(w.hrAvg)}` : null,
            ].filter(Boolean);
            return (
              <div key={w.id} className="consistency-row">
                <div>
                  <strong>{w.title}</strong>
                  <span className="muted">{meta.join(" · ")}</span>
                </div>
                <span className="source-pill">{w.source}</span>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cuore

function HeartSection({ data, workouts }: { data: HealthTrends; workouts: Workout[] }) {
  const heart = data.heart;
  if (!heart) return <p className="card trend-empty muted">{t.trends.noData}</p>;
  const values = data.days.flatMap((d) => (d.restingHr === null ? [] : [d.restingHr]));
  const lo = Math.min(...values) - 2;
  const hi = Math.max(...values) + 2;
  const X = (i: number) => 30 + (data.days.length === 1 ? 0 : (i / (data.days.length - 1)) * 286);
  const Y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * 100;
  const points = data.days.flatMap((d, i) => (d.restingHr === null ? [] : [{ x: X(i), y: Y(d.restingHr), d }]));
  const last = points.at(-1)!;
  const g1 = Math.ceil(lo + (hi - lo) * 0.75);
  const g2 = Math.floor(lo + (hi - lo) * 0.25);
  const delta = heart.previousAverage === null ? null : heart.average - heart.previousAverage;
  const avgLabel = formatKcal(heart.average);
  const types = byType(workouts).filter(([, v]) => v.hr.length > 0);

  return (
    <>
      <div className="trend-tiles">
        <Tile label={t.trends.restingHr} value={t.trends.bpm(avgLabel)} note={t.trends.daysAverage(heart.days)} />
        <Tile label={t.trends.minimum} value={t.trends.bpm(formatKcal(heart.min.value))} note={formatShortDate(heart.min.date)} />
        <Tile
          label={t.trends.versusBefore}
          value={delta === null ? "—" : `${delta <= 0 ? "▼" : "▲"} ${t.trends.bpm(formatOneDecimal(Math.abs(delta)))}`}
          note={delta === null ? t.trends.noPrevious : t.trends.previousDays(data.period)}
          accent={delta !== null && delta <= 0}
        />
      </div>

      <section className="card week-chart" aria-label={t.trends.hrOverTime}>
        <CardHead title={t.trends.hrOverTime} source={data.source} />
        <svg className="hr-trend" viewBox="0 0 320 130" role="img" aria-label={t.trends.hrAria(formatShortDate(data.from), avgLabel)}>
          {[g1, g2].map((g) => (
            <g key={g}>
              <line className="hr-grid" x1="30" x2="316" y1={Y(g)} y2={Y(g)} />
              <text className="hr-axis" x="26" y={Y(g) + 3} textAnchor="end">
                {g}
              </text>
            </g>
          ))}
          <line className="hr-average" x1="30" x2="316" y1={Y(heart.average)} y2={Y(heart.average)} />
          <polyline className="hr-line" points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
          {points.map((p) => (
            <circle key={p.d.date} className="hr-hit" cx={p.x} cy={p.y} r="5">
              <title>{t.trends.hrPoint(dayLabel(p.d.date), formatKcal(p.d.restingHr!))}</title>
            </circle>
          ))}
          <circle className="hr-last" cx={last.x} cy={last.y} r="4" />
          <text className="hr-average-label" x="316" y={Y(heart.average) - 4} textAnchor="end">
            {t.trends.average(avgLabel)}
          </text>
          <text className="hr-axis" x="30" y="126">
            {formatShortDate(data.from)}
          </text>
          <text className="hr-axis" x="316" y="126" textAnchor="end">
            {t.trends.today}
          </text>
        </svg>
        <span className="muted trend-note">{t.trends.hrNote}</span>
      </section>

      <section className="card consistency-card" aria-label={t.trends.hrByType}>
        <h2>{t.trends.hrByType}</h2>
        {types.length === 0 && <span className="muted trend-note">{t.trends.noWorkouts}</span>}
        {types.map(([type, v]) => (
          <div key={type} className="consistency-row">
            <div>
              <strong>{type}</strong>
            </div>
            <span className="muted">{t.trends.hrType(formatKcal(v.hr.reduce((a, b) => a + b, 0) / v.hr.length), t.trends.sessions(v.hr.length))}</span>
          </div>
        ))}
      </section>
    </>
  );
}

/**
 * Andamento › Salute (mockups AndamentoSalute, SaluteDesktop): tabs Sonno / Attività / Cuore on phones and tablets,
 * three columns on wide screens; period 7 / 30 / 90 days.
 */
export function HealthTrendsPage() {
  const [period, setPeriod] = useState<Period>(7);
  const [tab, setTab] = useState<Tab>("sleep");
  const trends = useHealthTrends(period);
  const data = trends.data;
  const workouts = useWorkouts(data?.from, data?.today);
  const list = workouts.data?.workouts ?? [];
  const hasData = data && (data.sleep || data.steps || data.heart);
  const since = data?.firstDataDate && data.firstDataDate > data.from ? t.trends.since(formatDayLongMonth(data.firstDataDate)) : null;

  return (
    <div className="page section-page trends-page">
      <header className="section-header">
        <div className="page-heading">
          <p className="page-date">{[t.trends.subtitle, since].filter(Boolean).join(" · ")}</p>
          <TrendsTitle page={t.trends.title} />
        </div>
      </header>
      <TrendsSwitch current="health" />

      {trends.isPending && <div className="card skeleton" style={{ height: 260 }} />}
      {trends.isError && <p className="notice" data-kind="error">{t.trends.loadFailed}</p>}
      {data && !hasData && (
        <section className="card trend-empty">
          <p className="muted">{t.trends.empty}</p>
          <Link href="/profilo/salute" className="button">
            {t.trends.emptyLink}
          </Link>
        </section>
      )}

      {data && hasData && (
        <>
          <div className="trend-controls">
            <div className="trend-tabs" role="tablist" aria-label={t.trends.tabs}>
              {TABS.map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className="trend-tab" onClick={() => setTab(key)}>
                  {t.trends[key]}
                </button>
              ))}
            </div>
            <div className="segmented period-switch" role="radiogroup" aria-label={t.trends.period}>
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={period === p}
                  aria-label={t.trends.periods[p]}
                  className="segmented-option"
                  onClick={() => setPeriod(p)}
                >
                  {t.trends.periodsShort[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="trends-columns" aria-busy={trends.isFetching}>
            <div className="trend-column-group" data-active={tab === "sleep" || undefined} role="tabpanel" aria-label={t.trends.sleep}>
              <h2 className="trend-column-title">{t.trends.sleep}</h2>
              <SleepSection data={data} />
            </div>
            <div className="trend-column-group" data-active={tab === "activity" || undefined} role="tabpanel" aria-label={t.trends.activity}>
              <h2 className="trend-column-title">{t.trends.activity}</h2>
              <ActivitySection data={data} workouts={list} />
            </div>
            <div className="trend-column-group" data-active={tab === "heart" || undefined} role="tabpanel" aria-label={t.trends.heart}>
              <h2 className="trend-column-title">{t.trends.heart}</h2>
              <HeartSection data={data} workouts={list} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
