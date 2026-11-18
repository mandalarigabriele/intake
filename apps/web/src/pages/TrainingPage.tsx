import type { TrainingDoneWorkout, TrainingLift, TrainingTargetExercise, TrainingView } from "@intake/shared";
import { useState, type ReactNode } from "react";
import { useTraining } from "../api/queries";
import { TrendsSwitch, TrendsTitle } from "../components/TrendsSwitch";
import { HeartRateChart } from "../components/WorkoutCard";
import { addDays } from "../lib/dates";
import { formatDuration, formatKcal, formatOneDecimal, formatWeekday, formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";

const LETTERS = ["L", "M", "M", "G", "V", "S", "D"];
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const kg = (value: number) => formatOneDecimal(value);
const shortDate = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;

/**
 * Exercise names in Italian. Hevy logs workouts in the app's language but names routine templates in English;
 * openGym names every exercise in English lower case ("barbell full squat"). Known names are translated, else the
 * equipment in brackets ("Squat (Barbell)" → "Squat (bilanciere)") and a capital first letter.
 */
export function exerciseName(exercise: Pick<TrainingTargetExercise, "title" | "templateTitle">): string {
  const known = t.training.exerciseNames[exercise.title] ?? t.training.exerciseNames[exercise.templateTitle];
  if (known) return known;
  if (exercise.title !== exercise.templateTitle && exercise.title !== exercise.title.toLowerCase()) return exercise.title;
  const name = exercise.templateTitle.replace(/\(([^)]+)\)$/, (whole, equipment: string) => {
    const it = t.training.equipment[equipment];
    return it ? `(${it})` : whole;
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Names of logged exercises (lifts): the same translation, from the title alone. */
const liftName = (title: string) => exerciseName({ title, templateTitle: title });

export function targetText(e: TrainingTargetExercise): string {
  if (e.label) return e.label.replace(/(\d)\.(\d)/g, "$1,$2");
  const range = e.repRange ? (e.repRange.start === e.repRange.end ? String(e.repRange.start) : `${e.repRange.start}–${e.repRange.end}`) : null;
  // openGym: the opening sets it computed, with the routine's range for context
  if (e.openingReps != null && e.sets > 0) {
    const same = e.weights.length > 0 && e.weights.every((w) => w === e.weights[0]);
    const opening = same || e.weights.length === 0 ? t.training.opening(e.sets, e.openingReps, e.weights[0] ? kg(e.weights[0]) : null) : t.training.perSet(e.weights.map(kg).join(" · "), String(e.openingReps));
    return range && range !== String(e.openingReps) ? `${opening} ${t.training.rangeNote(range)}` : opening;
  }
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

function plannedWhen(date: string, today: string): string {
  if (date === today) return t.training.todayWhen;
  if (date === addDays(today, 1)) return t.training.tomorrowWhen;
  return formatWeekdayDay(date).toLowerCase();
}

/** openGym's reason, in Italian when it is a known one. */
const reasonText = (note: string) => t.training.reasons[note] ?? t.training.reasonFallback;

function NextRoutine({ next, today, source, switcher }: { next: NonNullable<TrainingView["next"]>; today: string; source: NonNullable<TrainingView["source"]>; switcher?: ReactNode }) {
  const planned = next.date != null;
  // openGym often gives the same reason for every exercise: then it is shown once, under the list
  const reasons = [...new Set(next.exercises.flatMap((e) => (e.note ? [e.note] : [])))];
  const sharedReason = reasons.length === 1 ? reasons[0]! : null;
  const meta = [
    planned ? t.training.plannedFor(plannedWhen(next.date!, today)) : null,
    !planned && next.after ? t.training.after(next.after.title, whenLabel(next.after.date, today)) : null,
    t.training.exerciseCount(next.exerciseCount),
    next.typicalMinutes ? t.training.about(next.typicalMinutes) : null,
  ].filter(Boolean);
  return (
    <section className="card training-card training-next" aria-label={t.training.nextAria}>
      <div className="training-next-head">
        <span className="training-eyebrow">{planned ? t.training.nextPlanned : t.training.next}</span>
        <span className="source-pill">{source.label}</span>
      </div>
      {switcher}
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
              {e.note && !sharedReason && <span className="training-reason">{reasonText(e.note)}</span>}
            </div>
            {e.note ? (
              <span className="training-pill" data-kind="try" title={e.note}>
                {t.training.updated}
              </span>
            ) : e.suggestKg !== null ? (
              <span className="training-pill" data-kind="try">
                {t.training.tryKg(kg(e.suggestKg))}
              </span>
            ) : e.superset ? (
              <span className="training-pill">{t.training.superset}</span>
            ) : null}
          </div>
        ))}
      </div>
      {sharedReason && <span className="training-reason">{t.training.sharedReason(reasonText(sharedReason))}</span>}
      {source.openUrl && (
        <a className="training-open" href={source.openUrl} target="_blank" rel="noreferrer">
          {t.training.openApp(source.label)}
        </a>
      )}
    </section>
  );
}

type SessionView = "today" | "next";

/** "Oggi | Prossima" above the session card, when something was done today and a session is coming. */
function SessionSwitch({ view, onChange }: { view: SessionView; onChange: (view: SessionView) => void }) {
  return (
    <div className="segmented period-switch training-session-switch" role="radiogroup" aria-label={t.training.sessionSwitchAria}>
      {(["today", "next"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={view === v} className="segmented-option" onClick={() => onChange(v)}>
          {t.training.sessionViews[v]}
        </button>
      ))}
    </div>
  );
}

/** The sets of one exercise, consecutive equal sets grouped: "1 × 8 a 53,5 kg · 2 × 8 a 63,5 kg", warm-ups counted apart. */
export function doneSetsText(sets: TrainingDoneWorkout["exercises"][number]["sets"]): string {
  const work = sets.filter((s) => !s.warmup);
  const warmups = sets.length - work.length;
  const parts: string[] = [];
  const minutes = work.reduce((sum, s) => sum + (s.weightKg === null && s.reps === null ? (s.durationSeconds ?? 0) : 0), 0);
  if (minutes > 0) parts.push(t.training.minutesShort(Math.round(minutes / 60)));
  const groups: Array<{ count: number; weightKg: number | null; reps: number | null }> = [];
  for (const s of work) {
    if (s.weightKg === null && s.reps === null) continue;
    const last = groups.at(-1);
    if (last && last.weightKg === s.weightKg && last.reps === s.reps) last.count++;
    else groups.push({ count: 1, weightKg: s.weightKg, reps: s.reps });
  }
  for (const g of groups) parts.push(g.weightKg !== null ? t.training.sameWeight(g.count, String(g.reps ?? "–"), kg(g.weightKg)) : t.training.noWeight(g.count, String(g.reps ?? "–")));
  if (warmups > 0) parts.push(t.training.warmups(warmups));
  return parts.join(" · ");
}

/** Recap tiles: duration, heart rate and kcal (Apple Health), volume against the previous session, sets and reps. */
function recapStats(workout: TrainingDoneWorkout): Array<{ label: string; value: string; note?: string; kind?: "up" | "down" }> {
  const r = t.training.recap;
  const stats: Array<{ label: string; value: string; note?: string; kind?: "up" | "down" }> = [{ label: r.duration, value: formatDuration(workout.minutes) }];
  if (workout.hrAvg !== null) stats.push({ label: r.heartRate, value: r.bpm(formatKcal(workout.hrAvg)), note: workout.hrMax !== null ? r.max(formatKcal(workout.hrMax)) : undefined });
  if (workout.kcal !== null) stats.push({ label: r.kcal, value: formatKcal(workout.kcal) });
  const previous = workout.previous;
  const change = previous && previous.volumeKg > 0 ? Math.round(((workout.volumeKg - previous.volumeKg) / previous.volumeKg) * 100) : null;
  stats.push({
    label: r.volume,
    value: r.kg(formatKcal(workout.volumeKg)),
    note: change === null ? undefined : change === 0 ? r.same(formatWeekdayDay(previous!.date)) : r.change(change, formatWeekdayDay(previous!.date)),
    kind: change === null || change === 0 ? undefined : change > 0 ? "up" : "down",
  });
  stats.push({ label: r.sets, value: r.setsReps(workout.sets, workout.reps) });
  return stats;
}

/** "Oggi": the workout done today as a recap, then every exercise and its sets. */
function TodayWorkout({ workout, source, switcher }: { workout: TrainingDoneWorkout; source: NonNullable<TrainingView["source"]>; switcher?: ReactNode }) {
  // Duration and heart rate are in the tiles below
  const meta = `${workout.start} · ${t.training.exerciseCount(workout.exercises.length)}`;
  const records = workout.exercises.filter((e) => e.record).length;
  return (
    <section className="card training-card training-next" aria-label={t.training.doneTodayAria}>
      <div className="training-next-head">
        <span className="training-eyebrow">{t.training.doneToday}</span>
        <span className="source-pill">{source.label}</span>
      </div>
      {switcher}
      <div className="training-next-title">
        <h2>{workout.title}</h2>
        <span className="muted">{meta}</span>
      </div>
      <dl className="workout-stats training-recap">
        {recapStats(workout).map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
            {stat.note && (
              <span className="training-recap-note" data-kind={stat.kind}>
                {stat.note}
              </span>
            )}
          </div>
        ))}
      </dl>
      {workout.heartRate.length >= 2 ? (
        <HeartRateChart workout={{ heartRate: workout.heartRate, durationMinutes: workout.minutes, hrAvg: workout.hrAvg, hrMax: workout.hrMax }} />
      ) : (
        <span className="training-reason training-recap-hint">{workout.hrAvg === null ? t.training.recap.noHeartRate : t.training.recap.noCurve(workout.heartRateFrom ?? source.label)}</span>
      )}
      {records > 0 && <span className="training-recap-records">{t.training.recap.records(records)}</span>}
      <div className="training-list">
        {workout.exercises.map((e, i) => (
          <div key={`${e.title}-${i}`} className="training-row">
            <div className="training-row-text">
              <strong>{liftName(e.title)}</strong>
              <span className="muted">{doneSetsText(e.sets)}</span>
            </div>
            {e.record && (
              <span className="training-pill" data-kind="up">
                {t.training.recap.record}
              </span>
            )}
          </div>
        ))}
      </div>
      {source.openUrl && (
        <a className="training-open" href={source.openUrl} target="_blank" rel="noreferrer">
          {t.training.openApp(source.label)}
        </a>
      )}
    </section>
  );
}

function Week({ week, planned }: { week: TrainingView["week"]; planned: boolean }) {
  const other = week.other;
  return (
    <section className="card training-card" aria-label={t.training.weekAria}>
      <div className="week-chart-head">
        <h2>{t.training.week}</h2>
        {week.total > 0 && (
          <span className="training-pill" data-kind={week.done >= week.total ? "done" : undefined}>
            {t.training.rotation(week.done, week.total, planned)}
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
              data-planned={!d.letter && d.planned ? true : undefined}
              data-other={!d.letter && !d.planned && d.other ? true : undefined}
              title={t.training.dayTitle(formatWeekdayDay(d.date), d.title, d.minutes, d.other)}
            >
              {d.letter ?? d.planned ?? ""}
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
          <strong>{liftName(lift.title)}</strong>
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

/** openGym: muscles trained most and not at all over the last month. */
function Muscles({ muscles }: { muscles: NonNullable<TrainingView["muscles"]> }) {
  const name = (slug: string) => t.training.muscleNames[slug] ?? slug.replace(/-/g, " ");
  return (
    <section className="card consistency-card" aria-label={t.training.muscles}>
      <h2>{t.training.muscles}</h2>
      <div className="consistency-row">
        <div>
          <strong>{t.training.musclesTop}</strong>
          <span className="muted">{muscles.top.length ? muscles.top.map(name).join(", ") : t.training.musclesNone}</span>
        </div>
      </div>
      <div className="consistency-row">
        <div>
          <strong>{t.training.musclesNeglected}</strong>
          <span className="muted">{muscles.neglected.length ? muscles.neglected.map(name).join(", ") : t.training.musclesNone}</span>
        </div>
        {muscles.neglected.length > 0 && <span className="training-pill" data-kind="try">{muscles.neglected.length}</span>}
      </div>
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

/** Andamento › Allenamenti (mockups AndamentoAllenamenti, AllenamentiDesktop): live from the active workout source, nothing stored. */
export function TrainingPage() {
  const query = useTraining();
  const data = query.data;
  const source = data?.source ?? null;
  const planned = source?.id === "opengym";
  // Something done today: the card opens on it ("Oggi"), with "Prossima" one tap away; otherwise only the next session
  const [chosen, setChosen] = useState<SessionView | null>(null);
  const done = data?.todayWorkout ?? null;
  const view: SessionView = done && (chosen ?? "today") === "today" ? "today" : data?.next ? "next" : "today";
  const switcher = done && data?.next ? <SessionSwitch view={view} onChange={setChosen} /> : undefined;
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
            <span className="title-wide">{t.training.subtitleWide(data?.week.total ?? 0, !planned)}</span>
          </p>
          <TrendsTitle page={t.training.title} />
        </div>
      </header>
      <TrendsSwitch current="training" />

      {query.isPending && <div className="card skeleton" style={{ height: 260 }} />}
      {query.isError && <p className="notice" data-kind="error">{t.training.loadFailed}</p>}
      {data && !data.configured && <p className="card trend-empty muted">{t.training.notConfigured}</p>}
      {data?.hevyUnavailable && <p className="notice" data-kind="error">{t.training.unavailable(source?.label ?? t.training.sourceFallback)}</p>}
      {data && data.configured && !data.hevyUnavailable && !data.next && data.recent.length === 0 && <p className="card trend-empty muted">{t.training.empty}</p>}

      {data && data.configured && !data.hevyUnavailable && (data.next || data.recent.length > 0) && (
        <div className="training-flow">
          {source && view === "today" && done && <TodayWorkout workout={done} source={source} switcher={switcher} />}
          {source && view === "next" && data.next && <NextRoutine next={data.next} today={data.today} source={source} switcher={switcher} />}
          {data.week.days.length > 0 && <Week week={data.week} planned={planned} />}
          {data.muscles && <Muscles muscles={data.muscles} />}
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
