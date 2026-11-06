import {
  WEEKDAYS,
  dayTotals,
  foodLine,
  isFixedMeal,
  planAverages,
  weekdayOf,
  type PlanUploadError,
  type PlannedDay,
  type StoredPlan,
  type Weekday,
} from "@intake/shared";
import { useEffect, useRef, useState } from "react";
import { PlanUploadFailed, usePlans, useUploadPlan } from "../api/queries";
import { CloseIcon, PlanIcon } from "../components/icons";
import { formatKcal, formatMediumDate, formatShortDate } from "../lib/format";
import { t } from "../lib/strings";
import { Scrim } from "../components/Scrim";

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
  const plans = usePlans();
  const upload = useUploadPlan();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: PlanUploadError["issues"] } | null>(null);

  const data = plans.data;
  // Show the plan in effect today, or the next scheduled one if none is active yet
  const scheduled = data?.versions.filter((v) => v.status === "scheduled").at(-1);
  const [scheduledPlan, setScheduledPlan] = useState<StoredPlan | null>(null);
  useEffect(() => {
    if (data && !data.active && scheduled) {
      fetch(`/api/plans/${scheduled.id}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then(setScheduledPlan)
        .catch(() => setScheduledPlan(null));
    }
  }, [data, scheduled]);
  const shown = data?.active ?? scheduledPlan;

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
          {subtitle && <p className="page-date">{subtitle}</p>}
          <h1 className="page-title">{t.plan.title}</h1>
        </div>
        <div className="profile">
          <button type="button" className="icon-button" aria-label={t.plan.manage} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
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
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </header>

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
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {t.plan.upload}
          </button>
        </div>
      )}

      {shown && day && (
        <>
          <div className="plan-tabs" role="tablist" aria-label="Giorni">
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

            {day.meals.map((meal, i) =>
              isFixedMeal(meal) ? (
                <article key={i} className="plan-meal">
                  <header>
                    <h3>{meal.title}</h3>
                    {meal.time && <span className="muted">{meal.time}</span>}
                  </header>
                  <ul>
                    {meal.foods.map((food, j) => (
                      <li key={j}>{foodLine(food)}</li>
                    ))}
                  </ul>
                </article>
              ) : (
                <article key={i} className="plan-meal" data-free>
                  <h3>{meal.title}</h3>
                  <span className="free-badge">{t.plan.freeBadge}</span>
                </article>
              ),
            )}

            {shown.plan.notes && shown.plan.notes.length > 0 && (
              <details className="plan-notes">
                <summary>{t.plan.notes}</summary>
                <ul>
                  {shown.plan.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
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
