import type { HealthNight } from "@intake/shared";
import { formatDurationShort } from "../lib/format";
import { t } from "../lib/strings";

/** Stacked phase bar (deep / REM / core / awake) with a legend that names every phase and its minutes. */
export function SleepPhases({ night }: { night: HealthNight }) {
  const phases = [
    { key: "deep", label: t.activity.phases.deep, minutes: night.deepMinutes },
    { key: "rem", label: t.activity.phases.rem, minutes: night.remMinutes },
    { key: "core", label: t.activity.phases.core, minutes: night.coreMinutes },
    { key: "awake", label: t.activity.phases.awake, minutes: night.awakeMinutes },
  ];
  const total = phases.reduce((sum, p) => sum + p.minutes, 0);
  if (total === 0) return null;
  return (
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
  );
}
