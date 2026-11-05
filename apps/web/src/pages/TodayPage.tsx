import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useAddWater, useDay, useLogPlanned, type User } from "../api/queries";
import { CalorieCard } from "../components/CalorieCard";
import { PlusIcon } from "../components/icons";
import { Logo } from "../components/Logo";
import { MacroCard } from "../components/MacroCard";
import { ProfileMenu } from "../components/ProfileMenu";
import { Timeline } from "../components/Timeline";
import { WaterCard } from "../components/WaterCard";
import { WeekStrip } from "../components/WeekStrip";
import { isIsoDate } from "../lib/dates";
import { formatLongDate, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";
import { ConnectPage } from "./ConnectPage";

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
}

export function TodayPage({ user, notice, onAdd }: Props) {
  const [selected, setSelected] = useSelectedDay();
  const [today, setToday] = useState<string | null>(null);
  const day = useDay(selected);
  const addWater = useAddWater(selected);
  const logPlanned = useLogPlanned(selected);

  useEffect(() => {
    if (day.data) setToday(day.data.clock.localDate);
  }, [day.data]);

  if (day.error instanceof ApiError && day.error.code === "nutrition_not_connected") {
    return <ConnectPage />;
  }

  const view = day.data;
  const selectDate = (date: string) => setSelected(date === today ? "today" : date);
  const title = view ? (view.isToday ? t.today : formatWeekday(view.date)) : t.today;

  return (
    <div className="page today-page">
      <div className="today-top">
        <div className="page-heading">
          <div className="brand-row">
            <Logo />
            <span>{t.appName}</span>
          </div>
          <p className="page-date">{view ? formatLongDate(view.date) : " "}</p>
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="today-avatar">
          <ProfileMenu user={user} variant="avatar" />
        </div>
        {view && today && <WeekStrip selected={view.date} today={today} onSelect={selectDate} />}
      </div>

      {notice && <p className="notice">{notice}</p>}

      {day.isPending && <DaySkeleton />}

      {day.isError && !view && (
        <section className="card empty-state">
          <p>{t.errors.loadFailed}</p>
          <button type="button" className="button" onClick={() => day.refetch()}>
            {t.retry}
          </button>
        </section>
      )}

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
          <Timeline
            date={view.date}
            meals={view.meals}
            planned={view.planned}
            hasPlan={view.hasPlan}
            now={view.isToday ? view.clock.localTime : null}
            onLogPlanned={(entry) => logPlanned.mutate({ date: view.date, planId: entry.planId, index: entry.index })}
            loggingPlanned={
              logPlanned.variables && (logPlanned.isPending || logPlanned.isError)
                ? (view.planned.find((p) => p.planId === logPlanned.variables!.planId && p.index === logPlanned.variables!.index) ?? null)
                : null
            }
            logFailed={logPlanned.isError}
            onOther={onAdd}
          />
        </div>
      )}

      <button type="button" className="fab" aria-label={t.nav.add} onClick={onAdd}>
        <PlusIcon size={26} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function DaySkeleton() {
  return (
    <div className="day-layout" aria-label={t.loading}>
      <div className="day-summary">
        <div className="card skeleton" style={{ height: 172 }} />
        <div className="card skeleton" style={{ height: 196 }} />
        <div className="card skeleton" style={{ height: 80 }} />
      </div>
      <div className="card skeleton" style={{ height: 240 }} />
    </div>
  );
}
