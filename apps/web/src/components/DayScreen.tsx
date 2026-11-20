import type { DayView } from "@intake/shared";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ApiError } from "../api/client";
import { useDay, type User } from "../api/queries";
import { addDays, isIsoDate } from "../lib/dates";
import { formatKcal, formatLongDate, formatShortDate } from "../lib/format";
import { t } from "../lib/strings";
import { ConnectPage } from "../pages/ConnectPage";
import { dayHref } from "../pages/MealPage";
import { Logo } from "./Logo";
import { ProfileLink } from "./ProfileLink";
import { WeekStrip } from "./WeekStrip";

/** "today" or a YYYY-MM-DD date, kept in the URL (?d=) so reloads and the back button keep the day. */
function useSelectedDay(): [string, (date: string) => void] {
  const [selected, setSelected] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("d");
    return isIsoDate(fromUrl) ? fromUrl : "today";
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected === "today") url.searchParams.delete("d");
    else url.searchParams.set("d", selected);
    window.history.replaceState(window.history.state, "", url);
  }, [selected]);
  return [selected, setSelected];
}

/**
 * Timeline: the date between the arrows opens the system date picker (wheel or calendar on iPhone). The native input
 * covers the label, so a tap reaches it directly; with a mouse, showPicker() opens the calendar. Future days are not offered.
 */
function DatePicker({ value, max, onChange }: { value: string; max: string; onChange: (date: string) => void }) {
  return (
    <label className="day-picker" title={t.dayNav.chooseDate}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
      <span aria-hidden="true">{formatShortDate(value)}</span>
      <input
        type="date"
        value={value}
        max={max}
        aria-label={t.dayNav.dateLabel(formatLongDate(value))}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Not allowed here (e.g. in an iframe): the input still works by keyboard
          }
        }}
        onChange={(event) => {
          const date = event.target.value;
          if (isIsoDate(date) && date <= max) onChange(date);
        }}
      />
    </label>
  );
}

interface Props {
  user: User;
  notice: string | null;
  /**
   * "today": logo row, profile avatar and week strip (Oggi).
   * "timeline": "date · kcal" subtitle, previous/next day arrows with a date picker between them and "Oggi" (Timeline mockup).
   */
  variant: "today" | "timeline";
  title: (view: DayView | undefined) => string;
  className?: string;
  skeleton: ReactNode;
  children: (view: DayView, selected: string) => ReactNode;
}

/** Shared frame of the day screens: header, day selection, loading and error states. */
export function DayScreen({ user, notice, variant, title, className, skeleton, children }: Props) {
  const [selected, setSelected] = useSelectedDay();
  const [today, setToday] = useState<string | null>(null);
  const day = useDay(selected);

  useEffect(() => {
    if (day.data) setToday(day.data.clock.localDate);
  }, [day.data]);

  if (day.error instanceof ApiError && day.error.code === "nutrition_not_connected") {
    return <ConnectPage />;
  }

  const view = day.data;
  const selectDate = (date: string) => setSelected(date === today ? "today" : date);

  return (
    <div className={`page today-page ${className ?? ""}`}>
      {variant === "today" ? (
        <div className="today-top">
          <div className="page-heading">
            <div className="brand-row">
              <Logo />
              <span>{t.appName}</span>
            </div>
            <p className="page-date">{view ? formatLongDate(view.date) : " "}</p>
            <h1 className="page-title">{title(view)}</h1>
            {view && today && (
              <Link href={dayHref(view.date, today)} className="activity-more day-timeline-link">
                {t.dayNav.openTimeline}
              </Link>
            )}
          </div>
          <div className="today-avatar">
            <ProfileLink user={user} variant="avatar" />
          </div>
          {view && today && <WeekStrip selected={view.date} today={today} onSelect={selectDate} />}
        </div>
      ) : (
        <header className="section-header">
          <div className="page-heading">
            <p className="page-date">{view ? `${formatLongDate(view.date)} · ${formatKcal(view.totals.kcal)} kcal` : " "}</p>
            <h1 className="page-title">{title(view)}</h1>
          </div>
          <div className="week-nav day-nav">
            {view && today && view.date !== today && (
              <button type="button" className="day-today" aria-label={t.dayNav.goToday} onClick={() => selectDate(today)}>
                {t.today}
              </button>
            )}
            <button type="button" className="icon-button" aria-label={t.timeline.previousDay} disabled={!view} onClick={() => view && selectDate(addDays(view.date, -1))}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            {view && today && <DatePicker value={view.date} max={today} onChange={selectDate} />}
            <button
              type="button"
              className="icon-button"
              aria-label={t.timeline.nextDay}
              disabled={!view || !today || view.date >= today}
              onClick={() => view && selectDate(addDays(view.date, 1))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </header>
      )}

      {notice && <p className="notice">{notice}</p>}

      {day.isPending && skeleton}

      {day.isError && !view && (
        <section className="card empty-state">
          <p>
            {day.error instanceof ApiError && day.error.code === "nutrition_rate_limited"
              ? t.errors.rateLimited(day.error.retryAfter ?? 30)
              : t.errors.loadFailed}
          </p>
          <button type="button" className="button" onClick={() => day.refetch()}>
            {t.retry}
          </button>
        </section>
      )}

      {view && <div aria-busy={day.isFetching}>{children(view, selected)}</div>}
    </div>
  );
}
