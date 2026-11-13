import type { DailyScores } from "@intake/shared";
import { useState } from "react";
import { useHealthScores } from "../api/queries";
import { formatDuration, formatKcal, formatOneDecimal } from "../lib/format";
import { t } from "../lib/strings";

type RingKey = "effort" | "recovery" | "sleep";

const R = 38;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Text state for every ring (never colour alone, docs/design § Today rings). */
function stateOf(key: RingKey, percent: number): { label: string; level: "low" | "medium" | "high" } {
  const s = t.scores.states;
  if (key === "effort") return percent >= 67 ? { label: s.intense, level: "low" } : percent >= 34 ? { label: s.moderate, level: "medium" } : { label: s.light, level: "high" };
  const [medium, high] = key === "sleep" ? [70, 85] : [34, 67];
  return percent >= high ? { label: s.high, level: "high" } : percent >= medium ? { label: s.medium, level: "medium" } : { label: s.low, level: "low" };
}

function Ring({ ringKey, percent, empty, open, onToggle }: { ringKey: RingKey; percent: number | null; empty: string; open: boolean; onToggle: () => void }) {
  const label = t.scores[ringKey];
  const state = percent === null ? null : stateOf(ringKey, percent);
  const value = percent === null ? "—" : `${percent}%`;
  return (
    <button
      type="button"
      className="score-ring"
      data-ring={ringKey}
      aria-pressed={open}
      aria-label={t.scores.ringAria(label, value, state?.label ?? empty)}
      onClick={onToggle}
    >
      <span className="score-ring-dial">
        <svg viewBox="0 0 92 92" aria-hidden="true">
          <circle className="score-ring-track" cx="46" cy="46" r={R} />
          {percent !== null && percent > 0 && (
            <circle
              className="score-ring-fill"
              cx="46"
              cy="46"
              r={R}
              strokeDasharray={`${(CIRCUMFERENCE * Math.min(percent, 100)) / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 46 46)"
            />
          )}
        </svg>
        <span className="score-ring-center">
          <strong>{value}</strong>
          <span>{t.scores.units[ringKey]}</span>
        </span>
      </span>
      <span className="score-ring-label">{label}</span>
      <span className="score-state" data-level={state?.level ?? "none"}>
        {state?.label ?? empty}
      </span>
    </button>
  );
}

/** Rows of the "come si calcola" panel, with the day's real inputs. */
function details(key: RingKey, scores: DailyScores): { title: string; text: string; rows: Array<{ k: string; v: string }> } {
  const s = t.scores;
  if (key === "effort") {
    const e = scores.effort;
    const rows: Array<{ k: string; v: string }> = [];
    if (!e || e.workouts.length === 0) rows.push({ k: s.workouts, v: s.noWorkouts });
    else e.workouts.forEach((w) => rows.push({ k: s.workouts, v: s.workoutRow(w.title, w.minutes, w.hrAvg !== null ? formatKcal(w.hrAvg) : null) }));
    if (e) rows.push(e.movement.from === "steps" ? { k: s.steps, v: formatKcal(e.movement.value) } : { k: s.activeEnergy, v: `${formatKcal(e.movement.value)} kcal` });
    if (scores.sources.length) rows.push({ k: s.source, v: scores.sources.join(" · ") });
    return { title: s.effortTitle, text: s.effortText, rows };
  }
  if (key === "recovery") {
    const r = scores.recovery;
    const rows: Array<{ k: string; v: string }> = [];
    const part = (k: "hrv" | "restingHr" | "respiratoryRate") => r?.parts.find((p) => p.key === k);
    const hrv = part("hrv");
    rows.push({ k: s.hrv, v: hrv ? `${formatKcal(hrv.value)} ms · ${s.average30(`${formatKcal(hrv.baseline!)} ms`)}` : s.notAvailable });
    const rhr = part("restingHr");
    if (rhr) rows.push({ k: s.restingHr, v: `${formatKcal(rhr.value)} bpm · ${s.average30(`${formatOneDecimal(rhr.baseline!)} bpm`)}` });
    const resp = part("respiratoryRate");
    if (resp) rows.push({ k: s.respiratoryRate, v: `${formatOneDecimal(resp.value)} · ${s.average30(formatOneDecimal(resp.baseline!))}` });
    const text = r?.percent === null ? `${s.recoveryText(false)} ${s.recoveryCalibrating}` : s.recoveryText(r?.usesHrv ?? false);
    return { title: s.recoveryTitle, text, rows };
  }
  const sl = scores.sleep;
  const rows = sl
    ? [
        { k: s.slept, v: formatDuration(sl.asleepMinutes) },
        { k: s.times, v: `${sl.bedtime} → ${sl.wake}` },
        { k: s.need, v: formatDuration(sl.needMinutes) },
        { k: s.regularity, v: sl.regularityPenalty > 0 ? s.penalty(sl.regularityPenalty) : s.regular },
      ]
    : [];
  return { title: s.sleepTitle, text: s.sleepText, rows };
}

/** Sforzo, Recupero and Sonno as percentages (docs/design § Today rings); tap a ring for how it is computed. */
export function ScoreRings({ date }: { date: string }) {
  const query = useHealthScores(date);
  const [open, setOpen] = useState<RingKey | null>(null);
  const scores = query.data;
  if (!scores || !scores.connected || scores.date !== date) return null;
  if (!scores.effort && !scores.recovery && !scores.sleep) return null;
  const toggle = (key: RingKey) => setOpen((current) => (current === key ? null : key));
  const info = open ? details(open, scores) : null;

  return (
    <section className="card score-card" aria-label={t.scores.aria}>
      <div className="score-rings">
        <Ring ringKey="effort" percent={scores.effort?.percent ?? null} empty={t.scores.noData} open={open === "effort"} onToggle={() => toggle("effort")} />
        <Ring
          ringKey="recovery"
          percent={scores.recovery?.percent ?? null}
          empty={scores.recovery ? t.scores.calibrating : t.scores.noData}
          open={open === "recovery"}
          onToggle={() => toggle("recovery")}
        />
        <Ring ringKey="sleep" percent={scores.sleep?.percent ?? null} empty={t.scores.noData} open={open === "sleep"} onToggle={() => toggle("sleep")} />
      </div>
      {info && (
        <div className="score-info" aria-live="polite">
          <strong>{info.title}</strong>
          <p>{info.text}</p>
          {info.rows.map((row, i) => (
            <div key={`${row.k}-${i}`} className="score-info-row">
              <span>{row.k}</span>
              <b>{row.v}</b>
            </div>
          ))}
        </div>
      )}
      <span className="score-hint">{t.scores.hint(scores.sources)}</span>
    </section>
  );
}
