import type { HealthDuplicate, HealthImportPreview, HealthStatus } from "@intake/shared";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ApiError } from "../api/client";
import { useHealthImport, useHealthStatus, useSetHealthSettings } from "../api/queries";
import { addDays } from "../lib/dates";
import { formatClock, formatDayLongMonth, formatDayMonth, formatKcal, formatMegabytes, formatShortDate, localIsoDate } from "../lib/format";
import { t } from "../lib/strings";

/** Same limit as the server (HEALTH_IMPORT_MAX_BYTES). */
const MAX_BYTES = 50 * 1024 * 1024;
const STEP_GOAL = { min: 2000, max: 30000, step: 500 };

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function Header({ eyebrow, title, back }: { eyebrow: string; title: string; back: { href: string } | { onClick: () => void; label: string } }) {
  return (
    <header className="health-header">
      {"href" in back ? (
        <Link href={back.href} className="icon-button" aria-label={t.health.back}>
          <BackIcon />
        </Link>
      ) : (
        <button type="button" className="icon-button" aria-label={back.label} onClick={back.onClick}>
          <BackIcon />
        </button>
      )}
      <div className="health-heading">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
    </header>
  );
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function lastDataLabel(receivedAt: string, today: string): string {
  const date = localIsoDate(receivedAt);
  const time = formatClock(receivedAt);
  if (date === today) return t.health.todayAt(time);
  if (date === addDays(today, -1)) return t.health.yesterdayAt(time);
  return t.health.dateAt(formatShortDate(date), time);
}

/** Data coverage per metric and day: present / present but irregular / missing (docs/design § Charts). */
function CoverageChart({ coverage }: { coverage: NonNullable<HealthStatus["coverage"]> }) {
  const labelWidth = 92;
  const width = 318;
  const days = coverage.rows[0]?.cells.length ?? 0;
  const step = (width - labelWidth) / Math.max(days, 1);
  const rowStep = 18;
  const height = coverage.rows.length * rowStep + 16;
  const dates = Array.from({ length: days }, (_, i) => addDays(coverage.from, i));
  const months = dates.flatMap((date, i) => (i === 0 || date.endsWith("-01") ? [{ i, label: formatShortDate(date).split(" ")[1] ?? "" }] : []));
  // Skip a month label that would overlap the previous one
  const visibleMonths = months.filter((m, k) => k === 0 || (m.i - months[k - 1]!.i) * step > 22);
  return (
    <svg
      className="coverage-chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={t.health.coverageLabel(formatDayLongMonth(coverage.from), formatDayLongMonth(coverage.to))}
    >
      {coverage.rows.map((row, r) => (
        <g key={row.metric}>
          <text x="0" y={r * rowStep + 10} className="coverage-label">
            {t.health.coverageRows[row.metric]}
          </text>
          {[...row.cells].map((cell, i) => (
            <rect key={i} x={labelWidth + i * step} y={r * rowStep} width={Math.max(step * 0.76, 1)} height="12" data-cell={cell}>
              <title>{`${t.health.coverageRows[row.metric]} · ${formatShortDate(dates[i]!)}: ${t.health.cellStates[cell]}`}</title>
            </rect>
          ))}
        </g>
      ))}
      {visibleMonths.map((m) => (
        <text key={m.i} x={labelWidth + m.i * step} y={height - 2} className="coverage-month">
          {m.label}
        </text>
      ))}
    </svg>
  );
}

function StatusCard({ status }: { status: HealthStatus }) {
  const stale = status.lastDate ? daysBetween(status.lastDate, status.today) : null;
  const badge =
    stale === null ? { text: t.health.empty, kind: "empty" } : stale <= 1 ? { text: t.health.fresh, kind: "fresh" } : { text: t.health.stale(stale), kind: "stale" };
  return (
    <section className="health-card" aria-label={t.health.status}>
      <div className="health-card-head">
        <span className="health-card-title">{t.health.status}</span>
        <span className="health-badge" data-kind={badge.kind}>
          {badge.text}
        </span>
      </div>
      {status.coverage ? (
        <>
          <div className="health-facts">
            <div>
              <span>{t.health.lastData}</span>
              <strong>{status.lastImport ? lastDataLabel(status.lastImport.receivedAt, status.today) : t.health.never}</strong>
            </div>
            <div>
              <span>{t.health.period}</span>
              <strong>{status.firstDate && status.lastDate ? t.health.range(formatShortDate(status.firstDate), formatShortDate(status.lastDate)) : "–"}</strong>
            </div>
            <div>
              <span>{t.health.days}</span>
              <strong>{formatKcal(status.days)}</strong>
            </div>
            <div>
              <span>{t.health.workouts}</span>
              <strong>{formatKcal(status.workouts)}</strong>
            </div>
          </div>
          <div className="health-coverage">
            <span className="health-subtitle">{t.health.coverage}</span>
            <CoverageChart coverage={status.coverage} />
            <div className="coverage-legend">
              {(["p", "i", "m"] as const).map((cell) => (
                <span key={cell}>
                  <span className="coverage-swatch" data-cell={cell} aria-hidden="true" />
                  {t.health.cellStates[cell]}
                </span>
              ))}
            </div>
          </div>
          {status.sources.length > 0 && (
            <div className="health-sources">
              {status.sources.map((source) => (
                <span key={source} className="source-pill">
                  {source}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="health-muted">{t.health.noDataYet}</p>
      )}
    </section>
  );
}

function ActiveEnergyWarning({ warning }: { warning: NonNullable<HealthStatus["activeEnergyWarning"]> }) {
  const [open, setOpen] = useState(false);
  const since = warning.since ? formatDayMonth(warning.since) : null;
  return (
    <section className="health-warning" aria-label={t.health.warningLabel}>
      <div className="health-warning-body">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l9 16H3zM12 10v4M12 17h.01" />
        </svg>
        <div>
          <span className="health-warning-label">{t.health.warningLabel}</span>
          <strong>{t.health.warningTitle(since)}</strong>
          <span className="health-muted">{t.health.warningText(since, warning.presentDays, warning.totalDays)}</span>
        </div>
      </div>
      <button type="button" className="health-warning-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t.health.howToFix}
      </button>
      {open && (
        <ol className="health-steps">
          {t.health.fixSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepGoalCard({ goal }: { goal: number }) {
  const save = useSetHealthSettings();
  const change = (delta: number) => {
    const next = Math.min(STEP_GOAL.max, Math.max(STEP_GOAL.min, goal + delta));
    if (next !== goal) save.mutate({ stepGoal: next });
  };
  return (
    <section className="health-card health-goal" aria-label={t.health.stepGoal}>
      <div className="health-goal-text">
        <span className="health-card-title">{t.health.stepGoal}</span>
        <span className="health-muted">{save.isError ? t.health.stepGoalFailed : t.health.stepGoalHint}</span>
      </div>
      <div className="stepper">
        <button type="button" aria-label={t.health.stepGoalLess} disabled={goal <= STEP_GOAL.min} onClick={() => change(-STEP_GOAL.step)}>
          −
        </button>
        <span aria-live="polite">{formatKcal(goal)}</span>
        <button type="button" aria-label={t.health.stepGoalMore} disabled={goal >= STEP_GOAL.max} onClick={() => change(STEP_GOAL.step)}>
          +
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Import

type ImportState =
  | { step: "reading" }
  | { step: "preview"; json: unknown; preview: HealthImportPreview }
  | { step: "importing"; json: unknown; preview: HealthImportPreview }
  | { step: "done"; preview: HealthImportPreview }
  | { step: "error"; code: string };

interface ChosenFile {
  name: string;
  size: number;
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "too_large";
    if (error.code === "not_health_export" || error.code === "no_data") return error.code;
  }
  return "failed";
}

/** "Fitbit 13:07–13:26 e 13:32–14:06 · Bevel 13:08–13:58"; names are quoted when the records disagree. */
function duplicateRecords(dup: HealthDuplicate): string {
  const bySource = new Map<string, HealthDuplicate["records"]>();
  for (const r of dup.records) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  return [...bySource.entries()]
    .map(([source, records]) => {
      const name = dup.renamed ? ` "${records[0]!.label}"` : "";
      return `${source}${name} ${records.map((r) => `${r.start}–${r.end}`).join(" e ")}`;
    })
    .join(" · ");
}

function duplicateResult(dup: HealthDuplicate): string {
  const parts = [dup.joined ? t.health.joined(`${dup.start}–${dup.end}`, dup.kept) : dup.renamed ? t.health.single : t.health.kept(dup.kept)];
  if (dup.heartRateFrom) parts.push(t.health.heartRateFrom(dup.heartRateFrom));
  parts.push(t.health.discarded(dup.discarded));
  return parts.join(" · ");
}

function PreviewSections({ preview }: { preview: HealthImportPreview }) {
  const [showDuplicates, setShowDuplicates] = useState(false);
  const { workouts } = preview;
  return (
    <>
      <section className="health-card" aria-label={t.health.preview}>
        <span className="health-overline">{t.health.preview}</span>
        <div className="health-facts health-facts-3">
          <div>
            <strong>{preview.firstDate && preview.lastDate ? t.health.range(formatShortDate(preview.firstDate), formatShortDate(preview.lastDate)) : "–"}</strong>
            <span>{t.health.periodShort}</span>
          </div>
          <div>
            <strong>{formatKcal(preview.days)}</strong>
            <span>{t.health.daysShort}</span>
          </div>
          <div>
            <strong>{formatKcal(workouts.sessions)}</strong>
            <span>{t.health.workoutsShort}</span>
          </div>
        </div>
      </section>

      <section className="health-card health-list" aria-label={t.health.metricsTitle}>
        <span className="health-card-title health-list-title">{t.health.metricsTitle}</span>
        {preview.metrics.map((m) => (
          <div key={m.metric} className="health-list-row">
            <span className="health-list-name">{t.health.metrics[m.metric]}</span>
            <span className="health-list-value">
              {m.metric === "sleep" ? t.health.nightCount(m.days) : t.health.dayCount(m.days)}
              {m.irregular && <span className="irregular-pill">{m.irregular.since ? t.health.irregularSince(formatDayMonth(m.irregular.since)) : t.health.irregular}</span>}
            </span>
          </div>
        ))}
      </section>

      {workouts.found > 0 && (
        <section className="health-card health-list" aria-label={t.health.workoutsTitle}>
          <div className="health-list-title">
            <span className="health-card-title">{t.health.workoutsTitle}</span>
            <span className="health-muted">{t.health.workoutsSummary(workouts.found, workouts.discarded, workouts.sessions)}</span>
          </div>
          {workouts.byFamily.map((f) => (
            <div key={f.family} className="health-list-row health-list-row-compact">
              <span className="health-list-name">{t.health.families[f.family] ?? f.family}</span>
              <span className="health-list-value">{formatKcal(f.count)}</span>
            </div>
          ))}
          {workouts.duplicates.length > 0 && (
            <>
              <button type="button" className="health-outline-button" aria-expanded={showDuplicates} onClick={() => setShowDuplicates((v) => !v)}>
                {showDuplicates ? t.health.hideDuplicates : t.health.showDuplicates(workouts.duplicates.length)}
              </button>
              {showDuplicates && (
                <div className="duplicate-list">
                  {workouts.duplicates.map((dup) => (
                    <div key={`${dup.date}-${dup.start}`} className="duplicate">
                      <strong>{`${formatDayMonth(dup.date)} · ${dup.label}`}</strong>
                      <span>{duplicateRecords(dup)}</span>
                      <span className="duplicate-result">{duplicateResult(dup)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {preview.ignored.length > 0 && (
        <section className="health-card health-ignored" aria-label={t.health.ignoredTitle}>
          <span className="health-card-title">{t.health.ignoredTitle}</span>
          {preview.ignored.map((group) => {
            const [name, why] = t.health.ignored[group]!;
            return (
              <div key={group}>
                <span>{name}</span>
                <span className="health-muted">{why}</span>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

function ImportView({ file, state, onImport, onClose, onChooseAnother }: {
  file: ChosenFile;
  state: ImportState;
  onImport: () => void;
  onClose: () => void;
  onChooseAnother: () => void;
}) {
  const showActions = state.step === "preview" || state.step === "importing";
  return (
    <div className="page detail-page health-page" data-actions={showActions || undefined}>
      <Header eyebrow={t.health.title} title={t.health.importTitle} back={{ onClick: onClose, label: t.health.importBack }} />

      <div className="health-file">
        <span className="health-file-icon" aria-hidden="true">
          JSON
        </span>
        <div>
          <strong>{file.name}</strong>
          <span className="health-muted">{formatMegabytes(file.size)}</span>
        </div>
      </div>

      {state.step === "reading" && <p className="health-muted" aria-busy="true">{t.health.reading}</p>}

      {state.step === "error" && (
        <section className="health-result" data-kind="error" role="alert">
          <span className="health-overline">{t.health.error}</span>
          <strong>{t.health.errors[state.code]![0]}</strong>
          <span>{t.health.errors[state.code]![1]}</span>
          <button type="button" className="health-result-button" onClick={onChooseAnother}>
            {t.health.chooseAnother}
          </button>
        </section>
      )}

      {state.step === "done" && (
        <section className="health-result" data-kind="ok" role="status">
          <span className="health-overline">{t.health.done}</span>
          <strong>
            {state.preview.newDays === 0
              ? t.health.doneUpdated(state.preview.updatedDays)
              : state.preview.updatedDays === 0
                ? t.health.doneNew(state.preview.days, state.preview.workouts.sessions)
                : t.health.doneMixed(state.preview.newDays, state.preview.updatedDays)}
          </strong>
          <span>
            {state.preview.newDays === 0
              ? t.health.doneReimport
              : state.preview.firstDate && state.preview.lastDate
                ? t.health.doneText(formatDayLongMonth(state.preview.firstDate), formatDayLongMonth(state.preview.lastDate))
                : ""}
          </span>
          <button type="button" className="health-result-button" onClick={onClose}>
            {t.health.finish}
          </button>
        </section>
      )}

      {(state.step === "preview" || state.step === "importing") && <PreviewSections preview={state.preview} />}

      {showActions && (
        <div className="health-actions">
          <button type="button" className="health-cancel" onClick={onClose}>
            {t.health.cancel}
          </button>
          <button type="button" className="health-confirm" disabled={state.step === "importing"} onClick={onImport}>
            {state.step === "importing" ? t.health.importing : t.health.import}
          </button>
        </div>
      )}
    </div>
  );
}

/** Profile › Apple Salute: data status, active energy warning, file import and step goal (docs/design Salute, SaluteImport). */
export function HealthPage() {
  const status = useHealthStatus();
  const send = useHealthImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [state, setState] = useState<ImportState>({ step: "reading" });

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setFile({ name: chosen.name, size: chosen.size });
    if (chosen.size > MAX_BYTES) return setState({ step: "error", code: "too_large" });
    setState({ step: "reading" });
    let json: unknown;
    try {
      json = JSON.parse(await chosen.text());
    } catch {
      return setState({ step: "error", code: "not_health_export" });
    }
    send.mutate(
      { json, commit: false },
      {
        onSuccess: ({ preview }) => setState({ step: "preview", json, preview }),
        onError: (error) => setState({ step: "error", code: errorCode(error) }),
      },
    );
  }

  function onImport() {
    if (state.step !== "preview") return;
    const { json, preview } = state;
    setState({ step: "importing", json, preview });
    send.mutate(
      { json, commit: true },
      {
        onSuccess: (result) => setState({ step: "done", preview: result.preview }),
        onError: (error) => setState({ step: "error", code: errorCode(error) }),
      },
    );
  }

  const input = <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />;

  if (file) {
    return (
      <>
        <ImportView file={file} state={state} onImport={onImport} onClose={() => setFile(null)} onChooseAnother={() => fileInput.current?.click()} />
        {input}
      </>
    );
  }

  return (
    <div className="page detail-page health-page">
      <Header eyebrow={t.health.eyebrow} title={t.health.title} back={{ href: "/" }} />
      {status.isPending && <div className="card skeleton" style={{ height: 260 }} />}
      {status.isError && <p className="notice" data-kind="error">{t.health.loadFailed}</p>}
      {status.data && <StatusCard status={status.data} />}
      {status.data?.activeEnergyWarning && <ActiveEnergyWarning warning={status.data.activeEnergyWarning} />}
      <section className="health-card" aria-label={t.health.importTitle}>
        <span className="health-card-title">{t.health.importTitle}</span>
        <span className="health-muted">{t.health.importHint}</span>
        <button type="button" className="health-upload" onClick={() => fileInput.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          {t.health.importButton}
        </button>
      </section>
      {status.data && <StepGoalCard goal={status.data.settings.stepGoal} />}
      {input}
    </div>
  );
}
