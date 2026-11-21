import {
  WEEKDAYS,
  dayTotals,
  planAverages,
  weekdayOf,
  type PlanUploadError,
  type PlannedDay,
  type Weekday,
} from "@intake/shared";
import { useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PlanUploadFailed, useDay, useFeatures, usePlan, usePlans, useSetPlanTime, useUploadPlan } from "../api/queries";
import { PlanDayMeals, PlanDaySummary, SameTimeSwitch } from "../components/PlanDay";
import { CloseIcon, PlanIcon, SparklesIcon } from "../components/icons";
import { formatKcal, formatMediumDate, formatShortDate } from "../lib/format";
import { t } from "../lib/strings";
import { Scrim } from "../components/Scrim";
import { NeedsCard } from "../components/NeedsCard";
import { PLAN_TAB_PARAM, planTabFromSearch, preferredPlanTab, type PlanTab } from "../lib/planTab";

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function dayTag(day: PlannedDay, isToday: boolean): string {
  if (isToday) return t.plan.today;
  if (day.label) return day.label;
  if (dayTotals(day).hasFreeMeal) return t.plan.free;
  const protein = dayTotals(day).protein;
  return protein !== null ? t.plan.proteinTag(String(roundTo(protein, 5))) : "";
}

function dayNote(day: PlannedDay): string {
  if (day.note) return day.note;
  const protein = dayTotals(day).protein;
  return protein !== null ? t.plan.proteinNote(String(roundTo(protein, 5))) : "";
}

export function PlanPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<PlanTab>(() => planTabFromSearch(search) ?? preferredPlanTab());
  const plans = usePlans();
  // "Genera con l'IA" needs the AI part (Pasti da foto) and the key
  const canGenerate = useFeatures().data?.recognition === true;
  const upload = useUploadPlan();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: PlanUploadError["issues"] } | null>(null);

  const data = plans.data;
  // Show the plan in effect today, or the next scheduled one if none is active yet
  const scheduled = data?.versions.filter((v) => v.status === "scheduled").at(-1);
  const scheduledPlan = usePlan(data && !data.active ? scheduled?.id : undefined).data ?? null;
  const shown = data?.active ?? scheduledPlan;
  // Goals for the day totals: today's view is usually cached by Oggi already
  const goals = useDay("today").data?.goals ?? null;
  const setTime = useSetPlanTime();
  const [sameTime, setSameTime] = useState(true);

  const todayWeekday = data ? weekdayOf(data.today) : "monday";
  const [selected, setSelected] = useState<Weekday | null>(null);
  const weekday = selected ?? todayWeekday;

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMenuOpen(false);
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: "error", text: t.plan.uploadNotJson });
      return;
    }
    upload.mutate(json, {
      onSuccess: (stored) => setMessage({ kind: "ok", text: t.plan.uploaded(formatShortDate(stored.validFrom)) }),
      onError: (error) =>
        setMessage(
          error instanceof PlanUploadFailed
            ? { kind: "error", text: t.plan.uploadInvalid, issues: error.issues }
            : { kind: "error", text: t.plan.uploadFailed },
        ),
    });
  }

  const averages = shown ? planAverages(shown.plan) : null;
  const subtitle = shown
    ? [
        data?.active ? t.plan.activeFrom(formatShortDate(shown.validFrom)) : t.plan.startsOn(formatShortDate(shown.validFrom)),
        averages ? t.plan.perDay(averages.kcal !== null ? formatKcal(roundTo(averages.kcal, 50)) : null, averages.protein !== null ? String(roundTo(averages.protein, 5)) : null) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const day = shown?.plan.days[weekday];
  const dayIndex = WEEKDAYS.indexOf(weekday);
  const activeVersion = data?.versions.find((v) => v.status === "active");

  return (
    <div className="page section-page plan-page">
      <header className="section-header">
        <div className="page-heading">
          {tab === "plan" && subtitle && <p className="page-date">{subtitle}</p>}
          <h1 className="page-title">{t.plan.title}</h1>
        </div>
        {tab === "plan" && (
          <div className="menu-anchor">
            <button type="button" className="icon-button" aria-label={t.plan.manage} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                {canGenerate && (
                  <button type="button" role="menuitem" className="menu-item menu-item-rich" onClick={() => navigate("/piano/genera")}>
                    <strong className="ai-label">
                      <SparklesIcon size={16} />
                      {t.planGen.menu}
                    </strong>
                    <span className="muted">{t.planGen.menuHint}</span>
                  </button>
                )}
                <button type="button" role="menuitem" className="menu-item menu-item-rich" disabled={!shown} onClick={() => navigate("/piano/spesa")}>
                  <strong>{t.shopping.menu}</strong>
                  <span className="muted">{t.shopping.menuHint}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-rich" disabled={!shown} onClick={() => navigate("/piano/stampa")}>
                  <strong>{t.shopping.print}</strong>
                  <span className="muted">{t.shopping.printHint}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-rich" onClick={() => fileInput.current?.click()}>
                  <strong>{t.plan.upload}</strong>
                  <span className="muted">{t.plan.uploadHint}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item-rich"
                  disabled={!data?.versions.length}
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <strong>{t.plan.history}</strong>
                  <span className="muted">{t.plan.historyHint(data?.versions.length ?? 0, activeVersion ? formatMediumDate(activeVersion.validFrom) : null)}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => setMenuOpen(false)}>
                  {t.close}
                </button>
              </div>
            )}
          </div>
        )}
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </header>

      <div className="segmented plan-switch" role="tablist" aria-label={t.plan.switch}>
        {(["plan", "needs"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className="segmented-option"
            onClick={() => {
              setTab(option);
              navigate(`/piano?vista=${PLAN_TAB_PARAM[option]}`, { replace: true });
            }}
          >
            {t.plan.tabs[option]}
          </button>
        ))}
      </div>

      {tab === "needs" ? (
        <NeedsCard />
      ) : (
        <>
          {message && (
            <div className="notice" data-kind={message.kind} role="status">
              <p>{message.text}</p>
              {message.issues && (
                <ul className="issues">
                  {message.issues.map((issue, i) => (
                    <li key={i}>
                      <code>{issue.path || "file"}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {plans.isPending && <div className="card skeleton" style={{ height: 320 }} />}

          {data && !shown && (
            <div className="coming-soon">
              <span className="coming-soon-icon">
                <PlanIcon size={32} />
              </span>
              <strong>{t.plan.emptyTitle}</strong>
              <p className="muted">{t.plan.emptyBody}</p>
              <div className="plan-empty-actions">
                {canGenerate && (
                  <button type="button" className="button button-ai" onClick={() => navigate("/piano/genera")}>
                    <SparklesIcon size={18} />
                    {t.planGen.menu}
                  </button>
                )}
                <button type="button" className={canGenerate ? "button-secondary-small" : "button"} onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                  {t.plan.upload}
                </button>
              </div>
            </div>
          )}

          {shown && day && (
            <div className="plan-layout">
              <div className="plan-tabs" role="tablist" aria-label={t.plan.daysTabs}>
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={w}
                    type="button"
                    role="tab"
                    className="plan-tab"
                    aria-selected={w === weekday}
                    aria-label={t.weekdaysLong[i]}
                    onClick={() => setSelected(w)}
                  >
                    <span className="plan-tab-letter">{t.weekdaysShort[i]}</span>
                    <span className="plan-tab-tag">{dayTag(shown.plan.days[w], data?.active ? w === todayWeekday : false)}</span>
                  </button>
                ))}
              </div>

              <div className="plan-day" role="tabpanel">
                <div className="plan-day-head">
                  <h2>{t.weekdaysLong[dayIndex]}</h2>
                  <span className="muted">{dayNote(day)}</span>
                </div>
                <PlanDayMeals
                  day={day}
                  timeBusy={setTime.isPending}
                  onTime={(index, time) => setTime.mutate({ id: shown.id, day: weekday, index, time, allDays: sameTime })}
                />
              </div>

              <aside className="plan-aside">
                <PlanDaySummary day={day} goals={goals} />
                <section className="card plan-times">
                  <SameTimeSwitch checked={sameTime} onChange={setSameTime} />
                  <p className="muted">{t.plan.timeHint}</p>
                  {setTime.isError && <p className="error-text">{t.plan.timeFailed}</p>}
                </section>
                {shown.plan.notes && shown.plan.notes.length > 0 && (
                  <details className="plan-notes" open>
                    <summary>{t.plan.notes}</summary>
                    <ul>
                      {shown.plan.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </aside>
            </div>
          )}
        </>
      )}

      {historyOpen && data && (
        <Scrim onClose={() => setHistoryOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t.plan.history} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <h2>{t.plan.history}</h2>
              <button type="button" className="icon-button" aria-label={t.close} onClick={() => setHistoryOpen(false)}>
                <CloseIcon size={18} strokeWidth={2.5} />
              </button>
            </div>
            <div className="sheet-list">
              {data.versions.map((version) => (
                <div key={version.id} className="sheet-row" data-static>
                  <span className="sheet-row-text">
                    <strong>{t.plan.validFrom(formatMediumDate(version.validFrom))}</strong>
                    <span className="muted">{t.plan.uploadedOn(formatMediumDate(version.uploadedAt.slice(0, 10)))}</span>
                  </span>
                  <span className="version-status" data-status={version.status}>
                    {t.plan.status[version.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Scrim>
      )}
    </div>
  );
}
