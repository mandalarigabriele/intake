import type { DayView } from "@intake/shared";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { useDay, type User } from "../api/queries";
import { isIsoDate } from "../lib/dates";
import { formatLongDate } from "../lib/format";
import { t } from "../lib/strings";
import { ConnectPage } from "../pages/ConnectPage";
import { PlusIcon } from "./icons";
import { Logo } from "./Logo";
import { ProfileMenu } from "./ProfileMenu";
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

interface Props {
  user: User;
  notice: string | null;
  onAdd: () => void;
  /** Page title for the selected day ("Oggi" / weekday, or "Timeline"). */
  title: (view: DayView | undefined) => string;
  className?: string;
  skeleton: ReactNode;
  children: (view: DayView, selected: string) => ReactNode;
}

/**
 * Shared frame of the day screens (Oggi and Timeline): header with date and title, profile
 * avatar on phones, week strip, loading and error states, and the floating "+" button.
 */
export function DayScreen({ user, notice, onAdd, title, className, skeleton, children }: Props) {
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
      <div className="today-top">
        <div className="page-heading">
          <div className="brand-row">
            <Logo />
            <span>{t.appName}</span>
          </div>
          <p className="page-date">{view ? formatLongDate(view.date) : " "}</p>
          <h1 className="page-title">{title(view)}</h1>
        </div>
        <div className="today-avatar">
          <ProfileMenu user={user} variant="avatar" />
        </div>
        {view && today && <WeekStrip selected={view.date} today={today} onSelect={selectDate} />}
      </div>

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

      <button type="button" className="fab" aria-label={t.nav.add} onClick={onAdd}>
        <PlusIcon size={26} strokeWidth={2.5} />
      </button>
    </div>
  );
}
