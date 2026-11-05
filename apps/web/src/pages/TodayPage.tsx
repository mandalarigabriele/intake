import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useAddWater, useDay, useSignOut, type User } from "../api/queries";
import { CalorieCard } from "../components/CalorieCard";
import { Header } from "../components/Header";
import { MacroCard } from "../components/MacroCard";
import { Timeline } from "../components/Timeline";
import { WaterCard } from "../components/WaterCard";
import { WeekStrip } from "../components/WeekStrip";
import { isIsoDate } from "../lib/dates";
import { formatLongDate, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

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
    window.history.replaceState(null, "", url);
  }, [selected]);
  return [selected, setSelected];
}

export function TodayPage({ user, notice }: { user: User; notice: string | null }) {
  const [selected, setSelected] = useSelectedDay();
  const [today, setToday] = useState<string | null>(null);
  const day = useDay(selected);
  const addWater = useAddWater(selected);
  const signOut = useSignOut();

  useEffect(() => {
    if (day.data) setToday(day.data.clock.localDate);
  }, [day.data]);

  const view = day.data;
  const selectDate = (date: string) => setSelected(date === today ? "today" : date);

  const title = view ? (view.isToday ? t.today : formatWeekday(view.date)) : t.today;
  const dateLabel = view ? formatLongDate(view.date) : "";

  return (
    <div className="page">
      <Header dateLabel={dateLabel} title={title} user={user} onSignOut={() => signOut.mutate()} />
      {notice && <p className="notice">{notice}</p>}

      {view && today && <WeekStrip selected={view.date} today={today} onSelect={selectDate} />}

      {day.isPending && <DaySkeleton />}

      {day.isError && !view && <DayError error={day.error} onRetry={() => day.refetch()} />}

      {view && (
        <div className="day-layout" aria-busy={day.isFetching}>
          <div className="day-summary">
            <CalorieCard eaten={view.totals.kcal} goal={view.goals.kcal} />
            <MacroCard totals={view.totals} goals={view.goals} />
            <WaterCard
              totalMl={view.totals.waterMl}
              goalMl={view.goals.waterMl}
              canAdd={view.isToday}
              adding={addWater.isPending}
              failed={addWater.isError}
              onAdd={(amount) => addWater.mutate(amount)}
            />
          </div>
          <Timeline meals={view.meals} now={view.isToday ? view.clock.localTime : null} />
        </div>
      )}
    </div>
  );
}

function DaySkeleton() {
  return (
    <div className="day-layout" aria-label={t.loading}>
      <div className="day-summary">
        <div className="card skeleton" style={{ height: 180 }} />
        <div className="card skeleton" style={{ height: 200 }} />
        <div className="card skeleton" style={{ height: 88 }} />
      </div>
      <div className="card skeleton" style={{ height: 240 }} />
    </div>
  );
}

function DayError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === "nutrition_not_connected") {
    return (
      <section className="card empty-state">
        <h2>{t.errors.notConnectedTitle}</h2>
        <p className="muted">{t.errors.notConnectedBody}</p>
        <a className="button" href="/connect/nutrition">
          {t.errors.connect}
        </a>
      </section>
    );
  }
  return (
    <section className="card empty-state">
      <p>{t.errors.loadFailed}</p>
      <button type="button" className="button" onClick={onRetry}>
        {t.retry}
      </button>
    </section>
  );
}
