import type { HealthDay } from "@intake/shared";
import { useHealthDay } from "../api/queries";
import { formatClock, formatDuration, formatDurationShort, formatKcal, formatOneDecimal, formatShortDate, formatWeekdayDay, localIsoDate } from "../lib/format";
import { t } from "../lib/strings";

const W = 120;
const H = 34;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Line over the last days with the selected day as a dot (hollow while the day is in progress). Gaps break the line. */
function Sparkline({ points, className, label, tooltip, partial }: {
  points: Array<{ date: string; value: number | null }>;
  className: string;
  label: string;
  tooltip: (date: string, value: number, last: boolean) => string;
  partial: boolean;
}) {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 3 + (i * (W - 6)) / Math.max(points.length - 1, 1);
  const y = (v: number) => (max === min ? H / 2 : 28 - ((v - min) / (max - min)) * 22);
  const segments: string[][] = [[]];
  points.forEach((p, i) => {
    if (p.value === null) segments.push([]);
    else segments.at(-1)!.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  const lastIndex = points.length - 1;
  const last = points[lastIndex]!;
  return (
    <svg className={`spark ${className}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      {segments.filter((s) => s.length > 1).map((s, i) => (
        <polyline key={i} points={s.join(" ")} />
      ))}
      {points.map((p, i) =>
        p.value === null || i === lastIndex ? null : (
          <circle key={p.date} cx={x(i)} cy={y(p.value)} r="6" className="spark-hit">
            <title>{tooltip(p.date, p.value, false)}</title>
          </circle>
        ),
      )}
      {last.value !== null && (
        <circle cx={x(lastIndex)} cy={y(last.value)} r="4" className="spark-dot" data-partial={partial || undefined}>
          <title>{tooltip(last.date, last.value, true)}</title>
        </circle>
      )}
    </svg>
  );
}

/** Hours slept per night; the shortest night in amber (named in the caption and tooltip), the selected night solid. */
function SleepBars({ series, today }: { series: HealthDay["sleepSeries"]; today: string }) {
  const values = series.flatMap((s) => (s.minutes === null ? [] : [s.minutes]));
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const shortest = values.length > 1 ? Math.min(...values) : null;
  const barWidth = (W - 3 * (series.length - 1)) / series.length;
  return (
    <svg className="spark sleep-bars" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t.activity.sleepChart}>
      {series.map((s, i) => {
        if (s.minutes === null) return null;
        const height = Math.max(2, (s.minutes / max) * 32);
        const isShortest = s.minutes === shortest;
        const day = s.date === today ? t.activity.today : formatWeekdayDay(s.date);
        return (
          <rect
            key={s.date}
            x={i * (barWidth + 3)}
            y={H - height}
            width={barWidth}
            height={height}
            rx="2"
            data-shortest={isShortest || undefined}
            data-selected={i === series.length - 1 || undefined}
          >
            <title>{t.activity.sleepPoint(day, formatDurationShort(s.minutes), isShortest)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function updatedLabel(day: HealthDay): { text: string; stale: boolean } | null {
  if (day.lastDataDate && daysBetween(day.lastDataDate, day.today) > 1) {
    return { text: t.activity.stale(daysBetween(day.lastDataDate, day.today)), stale: true };
  }
  if (!day.lastImportAt) return null;
  const date = localIsoDate(day.lastImportAt);
  const time = formatClock(day.lastImportAt);
  return { text: date === day.today ? t.activity.updatedToday(time) : t.activity.updatedOn(formatShortDate(date), time), stale: false };
}

function StepsRow({ day }: { day: HealthDay }) {
  const isToday = day.date === day.today;
  const km = day.distanceKm !== null ? formatOneDecimal(day.distanceKm) : null;
  const avg = day.stepsAverage;
  let comparison: string | null = null;
  if (avg !== null && day.steps !== null) {
    if (isToday) comparison = t.activity.averageLater(formatKcal(avg));
    else {
      const pct = Math.round(((day.steps - avg) / avg) * 100);
      comparison = t.activity.versusAverage(pct > 0 ? "up" : pct < 0 ? "down" : "same", String(Math.abs(pct)), formatKcal(avg));
    }
  }
  const values = day.stepsSeries.map((p) => (p.value === null ? "–" : formatKcal(p.value))).join(", ");
  return (
    <div className="activity-row">
      <span className="activity-icon" data-kind="steps" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 15c-1.5 0-3-1.2-3-4s1-6 3-6 2.5 3 2.5 5-1 5-2.5 5zM17 21c-1.5 0-2.5-3-2.5-5s1-5 2.5-5 3 1.2 3 4-1 6-3 6z" />
        </svg>
      </span>
      <div className="activity-text">
        <span className="activity-value">
          {t.activity.steps(formatKcal(day.steps!))} <span className="activity-unit">{isToday ? t.activity.soFar(km) : km ? <><span className="activity-sep">· </span>{t.activity.km(km)}</> : ""}</span>
        </span>
        {comparison && <span className="activity-note">{comparison}</span>}
      </div>
      <div className="activity-chart">
        <Sparkline
          points={day.stepsSeries}
          className="spark-steps"
          label={t.activity.stepsChart(values)}
          partial={isToday}
          tooltip={(date, value, last) => t.activity.stepsPoint(date === day.today ? t.activity.today : formatWeekdayDay(date), formatKcal(value), last && isToday)}
        />
        <span>{t.activity.last7Days}</span>
      </div>
    </div>
  );
}

function SleepRow({ day }: { day: HealthDay }) {
  const night = day.sleep!;
  const phases = [
    { key: "deep", label: t.activity.phases.deep, minutes: night.deepMinutes },
    { key: "rem", label: t.activity.phases.rem, minutes: night.remMinutes },
    { key: "core", label: t.activity.phases.core, minutes: night.coreMinutes },
    { key: "awake", label: t.activity.phases.awake, minutes: night.awakeMinutes },
  ];
  const total = phases.reduce((sum, p) => sum + p.minutes, 0);
  return (
    <div className="activity-row activity-row-sleep">
      <span className="activity-icon" data-kind="sleep" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      </span>
      <div className="activity-sleep">
        <div className="activity-sleep-head">
          <div className="activity-text">
            <span className="activity-value">{formatDuration(night.asleepMinutes)}</span>
            <span className="activity-times">{`${night.bedtime} → ${night.wake}`}</span>
          </div>
          <div className="activity-chart">
            <SleepBars series={day.sleepSeries} today={day.today} />
            <span>{t.activity.sleepCaption}</span>
          </div>
        </div>
        {total > 0 && (
          <>
            <div
              className="sleep-phases"
              role="img"
              aria-label={t.activity.phasesLabel(
                formatDurationShort(night.deepMinutes),
                formatDurationShort(night.remMinutes),
                formatDurationShort(night.coreMinutes),
                formatDurationShort(night.awakeMinutes),
              )}
            >
              {phases.map((p) => (p.minutes > 0 ? <div key={p.key} data-phase={p.key} style={{ width: `${(p.minutes / total) * 100}%` }} /> : null))}
            </div>
            <div className="sleep-legend">
              {phases.map((p) => (
                <span key={p.key}>
                  <span className="sleep-swatch" data-phase={p.key} aria-hidden="true" />
                  {p.label} <strong>{formatDurationShort(p.minutes)}</strong>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HeartRow({ day }: { day: HealthDay }) {
  const hr = day.restingHr!;
  const lastWeek = day.restingHrLastWeek;
  const delta = lastWeek === null ? null : Math.round(hr - lastWeek);
  const sign = delta === null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "same";
  const values = day.restingHrSeries.map((p) => (p.value === null ? "–" : formatKcal(p.value))).join(", ");
  return (
    <div className="activity-row">
      <span className="activity-icon" data-kind="heart" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
        </svg>
      </span>
      <div className="activity-text">
        <span className="activity-value">
          {t.activity.bpm(formatKcal(hr))} <span className="activity-unit">{t.activity.restingHr}</span>
        </span>
        {sign && lastWeek !== null && (
          <span className="activity-note">
            <strong className="activity-delta" data-sign={sign}>
              {t.activity.hrVersus(sign, String(Math.abs(delta!)), formatKcal(lastWeek))}
            </strong>
            {sign !== "same" && t.activity.hrVersusTail(formatKcal(lastWeek))}
          </span>
        )}
      </div>
      <div className="activity-chart">
        <Sparkline
          points={day.restingHrSeries}
          className="spark-heart"
          label={t.activity.hrChart(values)}
          partial={false}
          tooltip={(date, value) => t.activity.hrPoint(date === day.today ? t.activity.today : formatWeekdayDay(date), formatKcal(value))}
        />
        <span>{t.activity.last8Days}</span>
      </div>
    </div>
  );
}

/**
 * "ATTIVITÀ E RIPOSO" on Oggi (docs/design § Today): steps, last night and resting heart rate from Apple Health,
 * with small trends. Hidden until Health data has been imported once.
 */
export function ActivityCard({ date }: { date: string }) {
  const query = useHealthDay(date);
  const day = query.data;
  if (!day || !day.connected || day.date !== date) return null;
  const hasData = day.steps !== null || day.sleep !== null || day.restingHr !== null;
  const updated = updatedLabel(day);
  return (
    <section className="card activity-card" aria-label={t.activity.aria}>
      <div className="activity-head">
        <span className="activity-label">{t.activity.label}</span>
        {day.source && hasData && <span className="source-pill">{day.source}</span>}
      </div>
      {!hasData ? (
        <p className="activity-empty">{t.activity.noData}</p>
      ) : (
        <>
          {day.steps !== null && <StepsRow day={day} />}
          {day.sleep && <SleepRow day={day} />}
          {day.restingHr !== null && <HeartRow day={day} />}
        </>
      )}
      {updated && (
        <span className="activity-updated" data-stale={updated.stale || undefined}>
          {updated.text}
        </span>
      )}
    </section>
  );
}
