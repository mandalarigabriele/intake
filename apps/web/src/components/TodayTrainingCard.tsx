import type { TrainingView } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useTraining } from "../api/queries";
import { addDays } from "../lib/dates";
import { formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";
import { exerciseName, targetText } from "../pages/TrainingPage";

const SHOWN = 3;

type Session = NonNullable<TrainingView["next"]>;
type View = "today" | "next";

/** "domani", "giovedì 20" or "" (Hevy rotation, no date). */
function whenOf(date: string | null | undefined, today: string): string {
  if (!date) return "";
  if (date === today) return t.training.todayWhen;
  return date === addDays(today, 1) ? t.training.tomorrowWhen : formatWeekdayDay(date).toLowerCase();
}

/** A planned session: title, when and how long, and its first exercises with openGym's opening sets. */
function SessionBlock({ session, today, showWhen }: { session: Session; today: string; showWhen: boolean }) {
  const when = showWhen ? whenOf(session.date, today) : "";
  const meta = [when ? t.training.plannedFor(when) : null, t.training.exerciseCount(session.exerciseCount), session.typicalMinutes ? t.training.about(session.typicalMinutes) : null];
  return (
    <>
      <div className="today-training-main">
        <strong>{session.date ? session.title : t.todayTraining.nextRoutine(session.title)}</strong>
        <span className="muted">{meta.filter(Boolean).join(" · ")}</span>
      </div>
      <ul className="today-training-list">
        {session.exercises.slice(0, SHOWN).map((e, i) => (
          <li key={`${e.templateId ?? e.title}-${i}`}>
            <span>{exerciseName(e)}</span>
            <span className="muted">{targetText(e)}</span>
          </li>
        ))}
        {session.exercises.length > SHOWN && <li className="muted">{t.todayTraining.more(session.exercises.length - SHOWN)}</li>}
      </ul>
    </>
  );
}

/**
 * "Allenamento di oggi" on Oggi (docs/design § Allenamenti). "Oggi" is what was done today, today's planned session
 * or rest; "Prossima" is the session after it. The selector appears only when both exist. Same data as
 * Andamento › Allenamenti.
 */
export function TodayTrainingCard({ date }: { date: string }) {
  const query = useTraining();
  const [view, setView] = useState<View>("today");
  const data = query.data;
  if (!data || !data.configured || data.hevyUnavailable || data.today !== date) return null;
  const source = data.source?.label ?? t.training.hevy;
  const done = data.recent.find((w) => w.date === date);
  const next = data.next;
  if (!done && !next) return null;

  // openGym plans by date: next is today's session, or a later one (rest today). Hevy's rotation has no date.
  const plannedToday = !done && next && (next.date == null || next.date === date) ? next : null;
  const restToday = !done && !plannedToday;
  const upcoming: Session | null = plannedToday ? (data.following ?? null) : next;
  const hasToday = Boolean(done || plannedToday || restToday);
  const both = hasToday && upcoming !== null;
  const shown: View = both ? view : upcoming && !hasToday ? "next" : "today";

  return (
    <section className="card today-training" aria-label={t.todayTraining.aria}>
      <div className="activity-head">
        <span className="activity-label">{both ? t.todayTraining.labelBoth : t.todayTraining.label}</span>
        <span className="source-pill">{source}</span>
      </div>
      {both && (
        <div className="segmented period-switch today-training-switch" role="radiogroup" aria-label={t.todayTraining.switchAria}>
          {(["today", "next"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={shown === v} className="segmented-option" onClick={() => setView(v)}>
              {t.todayTraining.views[v]}
            </button>
          ))}
        </div>
      )}
      {shown === "next" && upcoming ? (
        <SessionBlock session={upcoming} today={date} showWhen />
      ) : done ? (
        <div className="today-training-main">
          <strong>{t.todayTraining.done(done.title)}</strong>
          <span className="muted">{t.todayTraining.doneMeta(done.start, done.minutes, done.exercises)}</span>
        </div>
      ) : plannedToday ? (
        <SessionBlock session={plannedToday} today={date} showWhen={false} />
      ) : (
        <div className="today-training-main">
          <strong>{t.todayTraining.rest}</strong>
          {next && <span className="muted">{t.todayTraining.nextOn(whenOf(next.date, date), next.title)}</span>}
        </div>
      )}
      <Link href="/andamento/allenamenti" className="activity-more">
        {t.todayTraining.open}
      </Link>
    </section>
  );
}
