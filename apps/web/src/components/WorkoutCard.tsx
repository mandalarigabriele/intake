import type { Workout, WorkoutExercise } from "@intake/shared";
import { useId, useState } from "react";
import { formatDuration, formatGrams, formatKcal, formatOneDecimal } from "../lib/format";
import { t } from "../lib/strings";

/** Type icons by workout family (strength, cycling, football, walking, racket); anything else gets a pulse line. */
const FAMILY_ICONS: Record<string, string> = {
  Forza: "M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12",
  Ciclismo: "M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 15l4-7h5l3 7M9 8l3 7h2M13 5h2",
  Calcio: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v5M21 10.5l-5.5 0M3 10.5h5.5M7 19l2.8-4.5M17 19l-2.8-4.5",
  Camminata: "M13 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 21l2-6 3 3v3M8 12l2.5-4 3.5 1 2 3M12.5 8.5L11 15",
  Racchetta: "M15 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM11.5 11.5L4 19l1 1 7.5-7.5",
};
const DEFAULT_ICON = "M3 12h4l2-5 4 10 2-5h6";

/** Icon path of a workout family ("Forza", "Ciclismo", ...), with a generic pulse for the others. */
export const familyIcon = (family: string) => FAMILY_ICONS[family] ?? DEFAULT_ICON;

function exerciseNote(exercise: WorkoutExercise): string {
  const parts = [t.workouts.sets(exercise.workingSets)];
  if (exercise.best) parts.push(t.workouts.best(formatGrams(exercise.best.weightKg), exercise.best.reps));
  else if (exercise.durationSeconds > 0) parts.push(formatDuration(Math.max(1, Math.round(exercise.durationSeconds / 60))));
  return parts.join(" · ");
}

/** "Fonti" line: where the title, heart rate and kcal come from, and which duplicates were discarded. */
export function sourcesLine(workout: Workout): string {
  const discarded = workout.sources.filter((s) => !s.used).map((s) => s.label);
  const parts: string[] = [];
  if (workout.origin === "hevy") {
    parts.push(t.workouts.sourcesHevy);
    if (workout.heartRateFrom) parts.push(t.workouts.hrFromHealth);
    parts.push(workout.kcal !== null ? t.workouts.kcalFromHealth : t.workouts.noKcal);
  } else {
    parts.push(t.workouts.source(workout.source));
    if (workout.heartRateFrom && workout.heartRateFrom !== workout.source) parts.push(t.workouts.hrFrom(workout.heartRateFrom));
    if (workout.kcalFrom && workout.kcalFrom !== workout.source && workout.kcalFrom !== workout.heartRateFrom) parts.push(t.workouts.kcalFrom(workout.kcalFrom));
    if (workout.sources.length <= 1) parts.push(t.workouts.noDuplicates);
  }
  if (discarded.length > 0) parts.push(t.workouts.discarded(discarded));
  return parts.join(" · ");
}

const CHART = { width: 290, height: 104, left: 26, right: 282, top: 10, bottom: 86 };

/** Heart rate during the session: area and line, dashed average, max point; minutes on the x axis. */
function HeartRateChart({ workout }: { workout: Workout }) {
  const points = workout.heartRate;
  const bpms = points.map((p) => p.bpm);
  // The mockup scale (about 60–170 bpm) so sessions compare at a glance; it widens for values outside it
  const low = Math.min(60, Math.floor((Math.min(...bpms) - 10) / 20) * 20);
  const high = Math.max(170, Math.ceil((Math.max(...bpms) + 10) / 20) * 20);
  const span = Math.max(points.at(-1)!.minute, workout.durationMinutes, 1);
  const x = (minute: number) => CHART.left + (minute / span) * (CHART.right - CHART.left);
  const y = (bpm: number) => CHART.bottom - ((bpm - low) / (high - low)) * (CHART.bottom - CHART.top);
  const grid: number[] = [];
  for (let v = 100; v < high; v += 40) if (v > low) grid.push(v);
  const average = workout.hrAvg ?? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
  const peak = points.reduce((a, b) => (b.bpm > a.bpm ? b : a));
  const line = points.map((p) => `${x(p.minute).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(" ");
  const area = `M${x(points[0]!.minute).toFixed(1)},${CHART.bottom} L${line.replaceAll(" ", " L")} L${x(points.at(-1)!.minute).toFixed(1)},${CHART.bottom} Z`;
  const avgY = y(average);
  return (
    <div className="workout-hr">
      <span className="workout-section-label">{t.workouts.hrChart}</span>
      <svg
        className="hr-chart"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        width="100%"
        role="img"
        aria-label={t.workouts.hrChartLabel(formatKcal(average), formatKcal(workout.hrMax ?? peak.bpm))}
      >
        {grid.map((v) => (
          <g key={v}>
            <line className="hr-grid" x1={CHART.left} x2={CHART.right} y1={y(v)} y2={y(v)} />
            <text className="hr-axis" x={CHART.left - 4} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <path className="hr-area" d={area} />
        <polyline className="hr-line" points={line} />
        <line className="hr-average" x1={CHART.left} x2={CHART.right} y1={avgY} y2={avgY} />
        <text className="hr-average-label" x={CHART.right} y={avgY - 4} textAnchor="end">
          {t.workouts.hrAverage(formatKcal(average))}
        </text>
        {points.map((p) => (
          <circle key={p.minute} className="hr-hit" cx={x(p.minute)} cy={y(p.bpm)} r="4">
            <title>{t.workouts.hrPoint(p.minute, formatKcal(p.bpm))}</title>
          </circle>
        ))}
        <circle className="hr-peak" cx={x(peak.minute)} cy={y(peak.bpm)} r="4">
          <title>{t.workouts.hrPeak(formatKcal(peak.bpm))}</title>
        </circle>
        <text className="hr-axis" x={CHART.left} y={CHART.height - 4}>
          {t.workouts.minutes(0)}
        </text>
        <text className="hr-axis" x={CHART.right} y={CHART.height - 4} textAnchor="end">
          {t.workouts.minutes(span)}
        </text>
      </svg>
    </div>
  );
}

/**
 * A workout in the day timeline (docs/design TimelineMar10 / TimelineMer11): type icon, title, kcal when known,
 * time range and duration, chips and source; tap to open the stats, the heart-rate curve, the Hevy exercises
 * and the "Fonti" line.
 */
export function WorkoutCard({ workout }: { workout: Workout }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const typeNote = workout.type.toLowerCase() !== workout.title.toLowerCase() ? workout.type : null;
  const km = workout.distanceKm !== null ? formatOneDecimal(workout.distanceKm) : null;
  const chips = [
    workout.exercises.length > 0 ? t.workouts.exercises(workout.exercises.length) : null,
    km ? t.workouts.km(km) : null,
    workout.hrAvg !== null ? t.workouts.hrChip(formatKcal(workout.hrAvg), workout.origin === "hevy" && workout.hrMax !== null ? formatKcal(workout.hrMax) : null) : null,
  ].filter((c): c is string => c !== null);
  const stats: Array<[string, string]> = [[t.workouts.stats.duration, formatDuration(workout.durationMinutes)]];
  if (workout.sets > 0) stats.push([t.workouts.stats.sets, String(workout.sets)]);
  if (workout.volumeKg > 0) stats.push([t.workouts.stats.volume, t.workouts.volume(formatKcal(workout.volumeKg))]);
  if (workout.kcal !== null) stats.push([t.workouts.stats.kcal, t.workouts.kcal(formatKcal(workout.kcal))]);
  if (km) stats.push([t.workouts.stats.distance, t.workouts.km(km)]);
  if (workout.distanceKm !== null && workout.durationMinutes > 0) {
    stats.push([t.workouts.stats.speed, t.workouts.speed(formatOneDecimal(workout.distanceKm / (workout.durationMinutes / 60)))]);
  }
  if (workout.hrAvg !== null) stats.push([t.workouts.stats.hrAvg, t.workouts.bpm(formatKcal(workout.hrAvg))]);
  if (workout.hrMax !== null) stats.push([t.workouts.stats.hrMax, t.workouts.bpm(formatKcal(workout.hrMax))]);

  return (
    <article className="meal-card workout-card" data-kind="workout" aria-label={`${t.workouts.label} ${workout.title}`}>
      <button type="button" className="workout-main" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className="workout-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={FAMILY_ICONS[workout.family] ?? DEFAULT_ICON} />
          </svg>
        </span>
        <span className="workout-text">
          <span className="workout-title-row">
            <span className="workout-title">{workout.title}</span>
            {workout.kcal !== null && <span className="workout-kcal">{t.workouts.kcal(formatKcal(workout.kcal))}</span>}
          </span>
          <span className="workout-range">{t.workouts.range(workout.start, workout.end, formatDuration(workout.durationMinutes), typeNote)}</span>
        </span>
        <svg className="workout-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="workout-chips">
        {chips.map((chip) => (
          <span key={chip} className="workout-chip">
            {chip}
          </span>
        ))}
        <span className="source-pill">{workout.source}</span>
      </div>
      <div id={panelId} className="workout-details" hidden={!open}>
        <dl className="workout-stats">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {workout.heartRate.length >= 2 && <HeartRateChart workout={workout} />}
        {workout.exercises.length > 0 && (
          <ul className="workout-exercises">
            {workout.exercises.map((exercise, i) => (
              <li key={i}>
                <span>{exercise.title}</span>
                <span className="muted">{exerciseNote(exercise)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="workout-sources">{sourcesLine(workout)}</p>
      </div>
    </article>
  );
}
