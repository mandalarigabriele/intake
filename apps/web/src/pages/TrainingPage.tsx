import type { TrainingLift, TrainingTargetExercise, TrainingView } from "@intake/shared";
import { useTraining } from "../api/queries";
import { TrendsSwitch, TrendsTitle } from "../components/TrendsSwitch";
import { addDays } from "../lib/dates";
import { formatKcal, formatOneDecimal, formatWeekday, formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";

const LETTERS = ["L", "M", "M", "G", "V", "S", "D"];
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const kg = (value: number) => formatOneDecimal(value);
const shortDate = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;

/** Hevy template names are English: translate known ones, else the equipment in brackets ("Squat (Barbell)" → "Squat (bilanciere)"). */
export function exerciseName(exercise: Pick<TrainingTargetExercise, "title" | "templateTitle">): string {
  if (exercise.title !== exercise.templateTitle) return exercise.title;
  const known = t.training.exerciseNames[exercise.templateTitle];
  if (known) return known;
  return exercise.templateTitle.replace(/\(([^)]+)\)$/, (whole, equipment: string) => {
    const it = t.training.equipment[equipment];
    return it ? `(${it})` : whole;
  });
}

function targetText(e: TrainingTargetExercise): string {
  const range = e.repRange ? (e.repRange.start === e.repRange.end ? String(e.repRange.start) : `${e.repRange.start}–${e.repRange.end}`) : null;
  if (e.weights.length === 0) return range ? t.training.noWeight(e.sets, range) : t.training.sets(e.sets);
  const same = e.weights.every((w) => w === e.weights[0]);
  if (!range) return `${t.training.sets(e.sets)} · ${e.weights.map(kg).join(" · ")} kg`;
  return same ? t.training.sameWeight(e.sets, range, kg(e.weights[0]!)) : t.training.perSet(e.weights.map(kg).join(" · "), range);
}

function whenLabel(date: string, today: string): string {
  if (date === today) return t.training.today;
  if (date === addDays(today, -1)) return t.training.yesterday;
  return t.training.onDay(formatWeekday(date).toLowerCase());
}

function NextRoutine({ next, today }: { next: NonNullable<TrainingView["next"]>; today: string }) {
  const meta = [
    next.after ? t.training.after(next.after.title, whenLabel(next.after.date, today)) : null,
    t.training.exerciseCount(next.exerciseCount),
    next.typicalMinutes ? t.training.about(next.typicalMinutes) : null,
  ].filter(Boolean);
  return (
    <section className="card training-card training-next" aria-label={t.training.nextAria}>
      <div className="training-next-head">
        <span className="training-eyebrow">{t.training.next}</span>
        <span className="source-pill">{t.training.hevy}</span>
      </div>
      <div className="training-next-title">
        <h2>{next.title}</h2>
        <span className="muted">{meta.join(" · ")}</span>
      </div>
      <div className="training-list">
        {next.exercises.map((e, i) => (
          <div key={`${e.templateId ?? e.title}-${i}`} className="training-row">
            <div className="training-row-text">
              <strong>{exerciseName(e)}</strong>
              <span className="muted">{targetText(e)}</span>
            </div>
            {e.suggestKg !== null ? (
              <span className="training-pill" data-kind="try">
                {t.training.tryKg(kg(e.suggestKg))}
              </span>
            ) : e.superset ? (
              <span className="training-pill">{t.training.superset}</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Week({ week }: { week: TrainingView["week"] }) {
  const other = week.other;
  return (
    <section className="card training-card" aria-label={t.training.weekAria}>
      <div className="week-chart-head">
        <h2>{t.training.week}</h2>
        {week.total > 0 && (
          <span className="training-pill" data-kind={week.done >= week.total ? "done" : undefined}>
            {t.training.rotation(week.done, week.total)}
          </span>
        )}
      </div>
      <div className="training-days">
        {week.days.map((d, i) => (
          <div key={d.date} className="training-day">
            <span>{LETTERS[i]}</span>
            <span
              className="training-day-tile"
              data-active={d.letter ? true : undefined}
              data-other={!d.letter && d.other ? true : undefined}
              title={t.training.dayTitle(formatWeekdayDay(d.date), d.title, d.minutes, d.other)}
            >
              {d.letter ?? ""}
            </span>
          </div>
        ))}
      </div>
      <div className="training-stats">
        <div>
          <strong>{week.minutes >= 60 ? `${Math.floor(week.minutes / 60)} h ${String(week.minutes % 60).padStart(2, "0")}` : `${week.minutes} min`}</strong>
          <span className="muted">{t.training.gymTime}</span>
        </div>
        <div>
          <strong>{week.exercises}</strong>
          <span className="muted">{t.training.exercises}</span>
        </div>
        <div>
          <strong>{other.length ? t.training.other(other.length, other[0]!.type) : t.training.noOther}</strong>
          <span className="muted">{other.length ? t.training.otherNote(formatWeekday(other[0]!.date).toLowerCase(), other[0]!.source) : t.training.otherActivity}</span>
        </div>
      </div>
    </section>
  );
}

function changeLabel(change: TrainingLift["change"]): { text: string; kind: "up" | "ready" | "flat" } {
  switch (change.kind) {
    case "ready":
      return { text: t.training.readyToClimb(kg(change.suggestKg)), kind: "ready" };
    case "last":
      return { text: t.training.lastSession(kg(change.kg)), kind: "up" };
    case "since":
      return { text: t.training.since(kg(change.kg), MONTHS[Number(change.since.slice(5, 7)) - 1]!), kind: "up" };
    default:
      return { text: t.training.steady, kind: "flat" };
  }
}

/** Best working set per session as a small line with the lowest and highest weight on the axis. */
function LiftChart({ lift }: { lift: TrainingLift }) {
  const W = 300;
  const H = 96;
  const values = lift.points.map((p) => p.weightKg);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => 30 + (lift.points.length === 1 ? 131 : (i / (lift.points.length - 1)) * 262);
  const y = (v: number) => (hi === lo ? 46 : 74 - ((v - lo) / span) * 50);
  const label = t.training.chartAria(lift.title, lift.points.map((p) => t.training.point(shortDate(p.date), kg(p.weightKg), p.reps)).join(", "));
  return (
    <svg className="lift-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[lo, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <g key={v}>
          <line className="lift-grid" x1="30" x2="292" y1={y(v)} y2={y(v)} />
          <text className="lift-axis" x="25" y={y(v) + 3} textAnchor="end">
            {kg(v)}
          </text>
        </g>
      ))}
      <polyline className="lift-line" points={lift.points.map((p, i) => `${x(i).toFixed(1)},${y(p.weightKg).toFixed(1)}`).join(" ")} />
      {lift.points.map((p, i) => (
        <circle key={`${p.date}-${i}`} className="lift-dot" cx={x(i)} cy={y(p.weightKg)} r="3">
          <title>{t.training.point(shortDate(p.date), kg(p.weightKg), p.reps)}</title>
        </circle>
      ))}
    </svg>
  );
}

function Lift({ lift, routineTitles }: { lift: TrainingLift; routineTitles: Map<string, string> }) {
  const change = changeLabel(lift.change);
  const routines = lift.routines.map((letter) => routineTitles.get(letter) ?? letter).join(" e ");
  return (
    <div className="lift">
      <div className="lift-head">
        <div className="lift-text">
          <strong>{lift.title}</strong>
          <span className="muted">{routines}</span>
        </div>
        <span className="training-pill" data-kind={change.kind}>
          {change.text}
        </span>
      </div>
      <LiftChart lift={lift} />
    </div>
  );
}

function Progress({ lifts, routineTitles }: { lifts: TrainingLift[]; routineTitles: Map<string, string> }) {
  return (
    <section className="card training-card training-progress" aria-label={t.training.progress}>
      <div className="week-chart-head">
        <h2>{t.training.progress}</h2>
        <span className="muted">{t.training.progressNote}</span>
      </div>
      {lifts.map((lift) => (
        <Lift key={lift.templateId} lift={lift} routineTitles={routineTitles} />
      ))}
      <span className="muted training-note">{t.training.cablesNote}</span>
    </section>
  );
}

function Recent({ recent, today }: { recent: TrainingView["recent"]; today: string }) {
  return (
    <section className="card consistency-card training-recent" aria-label={t.training.recent}>
      <h2>{t.training.recent}</h2>
      {recent.map((w) => (
        <div key={w.id} className="consistency-row training-recent-row">
          <span className="training-letter" aria-hidden="true">
            {w.letter ?? "•"}
          </span>
          <div>
            <strong>{w.title}</strong>
            <span className="muted">
              {t.training.recentMeta(w.date === today ? t.training.todayLabel : formatWeekdayDay(w.date), w.start, w.minutes, w.exercises, w.hrAvg !== null ? formatKcal(w.hrAvg) : null)}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Andamento › Allenamenti (mockups AndamentoAllenamenti, AllenamentiDesktop): live from Hevy, nothing stored. */
export function TrainingPage() {
  const query = useTraining();
  const data = query.data;
  // "Full Body A" for the lift subtitles, from the week and recent workouts
  const routineTitles = new Map<string, string>();
  for (const w of [...(data?.recent ?? [])].reverse()) if (w.letter) routineTitles.set(w.letter, w.title.split(/\s+[—–-]\s+/)[0]!);
  if (data?.next) routineTitles.set(data.next.letter, data.next.title.split(/\s+[—–-]\s+/)[0]!);

  return (
    <div className="page section-page training-page">
      <header className="section-header">
        <div className="page-heading">
          <p className="page-date">
            <span className="title-phone">{t.training.subtitle}</span>
            <span className="title-wide">{t.training.subtitleWide(data?.week.total ?? 0)}</span>
          </p>
          <TrendsTitle page={t.training.title} />
        </div>
      </header>
      <TrendsSwitch current="training" />

      {query.isPending && <div className="card skeleton" style={{ height: 260 }} />}
      {query.isError && <p className="notice" data-kind="error">{t.training.loadFailed}</p>}
      {data && !data.configured && <p className="card trend-empty muted">{t.training.notConfigured}</p>}
      {data?.hevyUnavailable && <p className="notice" data-kind="error">{t.training.unavailable}</p>}
      {data && data.configured && !data.hevyUnavailable && !data.next && data.recent.length === 0 && <p className="card trend-empty muted">{t.training.empty}</p>}

      {data && data.configured && !data.hevyUnavailable && (data.next || data.recent.length > 0) && (
        <div className="training-flow">
          {data.next && <NextRoutine next={data.next} today={data.today} />}
          {data.week.days.length > 0 && <Week week={data.week} />}
          {data.lifts.length > 0 && <Progress lifts={data.lifts} routineTitles={routineTitles} />}
          {data.recent.length > 0 && <Recent recent={data.recent} today={data.today} />}
          {/* Desktop and iPad: one card per lift after the recent workouts (AllenamentiDesktop) */}
          {data.lifts.map((lift) => (
            <section key={lift.templateId} className="card training-card lift-card" aria-label={t.training.liftAria(lift.title)}>
              <Lift lift={lift} routineTitles={routineTitles} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
