import type { ProfileView, TrainingSourceId } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useDisconnectNutrition, useHealthStatus, useLogWeight, useNutritionStatus, useProfile, useSetHealthSettings, useSignOut, type User, useSetTrainingSource, useTrainingSource, useHevySync, useHevySyncAction } from "../api/queries";
import { Avatar } from "../components/ProfileLink";
import { RemindersSheet } from "../components/RemindersSheet";
import { BackIcon } from "../components/icons";
import { formatClock, formatKcal, formatShortDate, formatWater, formatWeight, formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";
import { exerciseName } from "./TrainingPage";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";

const THEMES: ThemePreference[] = ["system", "light", "dark"];
const STEP_GOAL = { min: 2000, max: 30000, step: 500 };

const CHART = { w: 300, h: 110, pad: 10 };
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Weigh-ins over time (x proportional to the date), with the target as a dashed line when it fits the scale. */
function WeightChart({ entries, target }: { entries: ProfileView["weight"]["entries"]; target: number | null }) {
  const values = entries.map((e) => e.weight);
  const showTarget = target !== null && target >= Math.min(...values) - 3 && target <= Math.max(...values) + 3;
  const all = showTarget ? [...values, target!] : values;
  const min = Math.min(...all) - 0.3;
  const max = Math.max(...all) + 0.3;
  const first = dayNumber(entries[0]!.date);
  const span = Math.max(dayNumber(entries.at(-1)!.date) - first, 1);
  const x = (date: string) => CHART.pad + ((dayNumber(date) - first) / span) * (CHART.w - CHART.pad * 2);
  const y = (kg: number) => CHART.pad + ((max - kg) / (max - min)) * (CHART.h - CHART.pad * 2);
  const points = entries.map((e) => `${x(e.date).toFixed(1)},${y(e.weight).toFixed(1)}`).join(" ");
  const label = t.profile.weightChart(entries.map((e) => t.profile.weightPoint(formatShortDate(e.date), formatWeight(e.weight))).join(", "));
  return (
    <svg className="weight-chart" viewBox={`0 0 ${CHART.w} ${CHART.h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} className="weight-grid" x1="0" x2={CHART.w} y1={CHART.h * f} y2={CHART.h * f} vectorEffect="non-scaling-stroke" />
      ))}
      {showTarget && <line className="weight-target" x1="0" x2={CHART.w} y1={y(target!)} y2={y(target!)} vectorEffect="non-scaling-stroke" />}
      <polyline className="weight-line" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function WeightCard({ profile }: { profile: ProfileView }) {
  const log = useLogWeight();
  const [value, setValue] = useState("");
  const { entries, target, unit } = profile.weight;
  const latest = entries.at(-1);
  const previous = entries.at(-2);
  const delta = latest && previous ? latest.weight - previous.weight : null;
  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 20 && parsed <= 400;
  const sign = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±");

  return (
    <section className="card profile-card" aria-label={t.profile.weight}>
      <div className="profile-card-head">
        <h2>{t.profile.weight}</h2>
        <span className="muted">{t.profile.weightCadence}</span>
      </div>
      <dl className="weight-stats">
        <div>
          <dt>{t.profile.last}</dt>
          <dd>{latest ? `${formatWeight(latest.weight)} ${unit}` : "—"}</dd>
        </div>
        <div>
          <dt>{t.profile.trend}</dt>
          <dd>{delta !== null ? `${sign(delta)}${formatWeight(Math.abs(delta))} ${unit}` : "—"}</dd>
          {previous && <dd className="weight-sub">{t.profile.trendNote(formatShortDate(previous.date))}</dd>}
        </div>
        <div>
          <dt>{t.profile.target}</dt>
          <dd>{target !== null ? `${formatWeight(target)} ${unit}` : "—"}</dd>
        </div>
      </dl>
      <div className="weight-plot" data-empty={entries.length < 2 || undefined}>
        {entries.length >= 2 ? (
          <WeightChart entries={entries} target={target} />
        ) : latest ? (
          <div className="weight-one">
            <span className="weight-dot" aria-hidden="true" />
            <span className="muted">{t.profile.oneWeight(formatShortDate(latest.date), formatWeight(latest.weight))}</span>
          </div>
        ) : (
          <span className="muted">{t.profile.noWeight}</span>
        )}
      </div>
      <form
        className="weight-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) log.mutate(Math.round(parsed * 10) / 10, { onSuccess: () => setValue("") });
        }}
      >
        <label className="weight-input">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={t.profile.weightPlaceholder} aria-label={t.profile.weightLabel} />
          <span className="muted">kg</span>
        </label>
        <button type="submit" className="button" disabled={!valid || log.isPending}>
          {t.profile.log}
        </button>
      </form>
      {log.isSuccess && <p className="notice" data-kind="ok">{t.profile.logged}</p>}
      {log.isError && <p className="error-text">{t.profile.logFailed}</p>}
      <span className="muted weight-note">{t.profile.weightHint}</span>
    </section>
  );
}

function StepGoal({ goal }: { goal: number }) {
  const save = useSetHealthSettings();
  const change = (delta: number) => {
    const next = Math.min(STEP_GOAL.max, Math.max(STEP_GOAL.min, goal + delta));
    if (next !== goal) save.mutate({ stepGoal: next });
  };
  return (
    <div className="stepper stepper-sm">
      <button type="button" aria-label={t.health.stepGoalLess} disabled={goal <= STEP_GOAL.min} onClick={() => change(-STEP_GOAL.step)}>
        −
      </button>
      <span aria-live="polite">{save.isError ? t.health.stepGoalFailed : formatKcal(goal)}</span>
      <button type="button" aria-label={t.health.stepGoalMore} disabled={goal >= STEP_GOAL.max} onClick={() => change(STEP_GOAL.step)}>
        +
      </button>
    </div>
  );
}

function GoalsCard({ goals, stepGoal }: { goals: ProfileView["goals"] | null; stepGoal: number | null }) {
  const names = t.profile.goalNames;
  const grams = (v: number | null) => (v === null ? t.profile.notSet : `${formatKcal(v)} g`);
  const rows = goals
    ? [
        { key: "kcal", label: names.kcal, value: goals.kcal === null ? t.profile.notSet : `${formatKcal(goals.kcal)} kcal` },
        { key: "protein", label: names.protein, value: grams(goals.protein) },
        { key: "carbs", label: names.carbs, value: grams(goals.carbs) },
        { key: "fat", label: names.fat, value: grams(goals.fat) },
        { key: "fiber", label: names.fiber, value: grams(goals.fiber) },
        { key: "water", label: names.water, value: goals.waterMl === null ? t.profile.notSet : formatWater(goals.waterMl) },
      ]
    : [];
  return (
    <section className="card profile-card profile-list" aria-label={t.profile.goals}>
      <div className="profile-card-head">
        <h2>{t.profile.goals}</h2>
        {goals && <span className="source-pill">{t.profile.goalsSource}</span>}
      </div>
      {rows.map((row) => (
        <div key={row.key} className="profile-row-item goal-row" data-goal={row.key}>
          <span className="goal-name">
            <span className="goal-swatch" aria-hidden="true" />
            {row.label}
          </span>
          <strong>{row.value}</strong>
        </div>
      ))}
      {stepGoal !== null && (
        <div className="profile-row-item goal-row" data-goal="steps">
          <span className="goal-name">
            <span className="goal-swatch" aria-hidden="true" />
            {names.steps}
          </span>
          <StepGoal goal={stepGoal} />
        </div>
      )}
    </section>
  );
}

type LinkState = "connected" | "warning" | "off" | "standby";

function ConnectionRow({ name, note, state, href }: { name: string; note: string; state: LinkState; href?: string }) {
  const body = (
    <>
      <span className="connection-text">
        <strong>{name}</strong>
        <span className="muted">{note}</span>
      </span>
      <span className="connection-state">
        <span className="state-pill" data-state={state}>
          {t.profile.states[state]}
        </span>
        {href && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="profile-row-item connection-row">
      {body}
    </Link>
  ) : (
    <div className="profile-row-item connection-row">{body}</div>
  );
}

/** Hevy and openGym rows, with the workout source switch when both are configured (one source at a time). */
function GymRows() {
  const status = useTrainingSource();
  const setSource = useSetTrainingSource();
  const data = status.data;
  if (!data) return null;
  const state = (id: TrainingSourceId): LinkState => (!data.available.includes(id) ? "off" : data.active === id ? "connected" : "standby");
  return (
    <>
      <ConnectionRow name={t.profile.hevy} note={data.available.includes("hevy") ? t.profile.hevyNote : t.profile.hevyMissing} state={state("hevy")} />
      <ConnectionRow name={t.profile.openGym} note={data.available.includes("opengym") ? t.profile.openGymNote : t.profile.openGymMissing} state={state("opengym")} />
      {data.available.length > 1 && (
        <div className="profile-row-item source-switch">
          <span className="connection-text">
            <strong id="training-source-label">{t.profile.trainingSource}</strong>
            <span className="muted">{setSource.isError ? t.profile.trainingSourceFailed : t.profile.trainingSourceNote}</span>
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="training-source-label">
            {data.available.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={data.active === id}
                className="segmented-option"
                disabled={setSource.isPending}
                onClick={() => data.active !== id && setSource.mutate(id)}
              >
                {id === "hevy" ? t.profile.hevy : t.profile.openGym}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** "Copia su Hevy": the optional copy of openGym workouts into Hevy, with what the next run sends (docs/hevy-sync.md). */
function HevySyncRow() {
  const status = useHevySync();
  const action = useHevySyncAction();
  const data = status.data;
  if (!data?.available) return null;
  const s = t.profile.hevySync;
  const last = data.lastRun;
  const note = action.isError
    ? s.failedAction
    : last?.error
      ? s.failed(formatClock(last.at))
      : last && data.enabled
        ? s.last(formatClock(last.at), last.created, last.updated)
        : data.enabled
          ? s.on
          : s.off;
  const pending = data.pending;
  return (
    <div className="profile-row-item hevy-sync">
      <label className="hevy-sync-head">
        <span className="connection-text">
          <strong>{s.title}</strong>
          <span className="muted">{note}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label={s.toggle}
          checked={data.enabled}
          disabled={action.isPending}
          onChange={(event) => {
            if (!event.target.checked) action.mutate("off");
            else if (window.confirm(s.confirm(pending?.length ?? 0))) action.mutate("on");
          }}
        />
      </label>
      {pending === null ? (
        <span className="muted hevy-sync-hint">{s.unavailable}</span>
      ) : pending.length === 0 ? (
        <span className="muted hevy-sync-hint">{s.nothing}</span>
      ) : (
        <details className="hevy-sync-preview">
          <summary>{s.pending(pending.length)}</summary>
          {pending.map((item) => (
            <div key={item.id} className="hevy-sync-item">
              <strong>
                {item.title}
                {item.action === "update" && <span className="state-pill" data-state="standby">{s.update}</span>}
              </strong>
              <span className="muted">{`${formatWeekdayDay(item.start.slice(0, 10))} · ${formatClock(item.start)} · ${item.minutes} min`}</span>
              <ul>
                {item.exercises.map((e, i) => (
                  <li key={`${e.name}-${i}`}>
                    <span>{exerciseName({ title: e.name, templateTitle: e.name })}</span>
                    <span className="muted">{e.hevyTitle ? `→ ${e.hevyTitle}` : s.newExercise}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      {data.enabled && (
        <button type="button" className="button-secondary-small hevy-sync-run" disabled={action.isPending} onClick={() => action.mutate("run")}>
          {s.run}
        </button>
      )}
    </div>
  );
}

/** Profilo (docs/design Profilo): weight, goals, connections, reminders, theme, Nutrition disconnect and sign out. */
export function ProfilePage({ user }: { user: User }) {
  const profile = useProfile();
  const health = useHealthStatus();
  const nutrition = useNutritionStatus(true);
  const signOut = useSignOut();
  const disconnect = useDisconnectNutrition();
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [reminders, setReminders] = useState(false);
  const data = profile.data;
  const healthState: LinkState = !health.data?.lastImport ? "off" : health.data.activeEnergyWarning ? "warning" : "connected";

  return (
    <div className="page detail-page profile-page">
      <header className="profile-header">
        <Link href="/" className="icon-button" aria-label={t.profile.back}>
          <BackIcon />
        </Link>
        <Avatar user={user} className="avatar profile-avatar" />
        <div className="profile-heading">
          <h1>{user.name ?? user.email}</h1>
          {user.name && <span className="muted">{user.email}</span>}
        </div>
      </header>

      <div className="profile-grid">
        <div className="profile-column">
          {profile.isPending && <div className="card skeleton" style={{ height: 320 }} />}
          {profile.isError && <p className="notice" data-kind="error">{t.profile.loadFailed}</p>}
          {data && <WeightCard profile={data} />}
          {(data || health.data) && <GoalsCard goals={data?.goals ?? null} stepGoal={health.data?.settings.stepGoal ?? null} />}
        </div>

        <div className="profile-column">
          <section className="card profile-card profile-list" aria-label={t.profile.connections}>
            <div className="profile-card-head">
              <h2>{t.profile.connections}</h2>
            </div>
            <ConnectionRow name={t.profile.google} note={t.profile.googleNote} state="connected" />
            <ConnectionRow name={t.profile.nutrition} note={t.profile.nutritionNote} state={nutrition.data?.connected === false ? "off" : "connected"} />
            <ConnectionRow
              name={t.profile.appleHealth}
              note={healthState === "warning" ? `${t.profile.appleHealthNote} · ${t.profile.appleHealthWarning}` : t.profile.appleHealthNote}
              state={healthState}
              href="/profilo/salute"
            />
            <GymRows />
            <HevySyncRow />
          </section>

          <section className="card profile-card profile-list" aria-label={t.profile.reminders}>
            <button type="button" className="profile-row-item connection-row profile-first-row" onClick={() => setReminders(true)}>
              <span className="connection-text">
                <strong>{t.profile.reminders}</strong>
                <span className="muted">{t.profile.remindersNote}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </section>

          <section className="card profile-card" aria-label={t.profile.appearance}>
            <h2 id="theme-label">{t.profile.appearance}</h2>
            <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  className="segmented-option"
                  onClick={() => {
                    setTheme(option);
                    setThemePreference(option);
                  }}
                >
                  {t.profile.themeOptions[option]}
                </button>
              ))}
            </div>
            <span className="muted weight-note">{t.profile.themeNote}</span>
          </section>

          <div className="profile-actions">
            {nutrition.data?.connected && (
              <button
                type="button"
                className="profile-action"
                onClick={() => {
                  if (window.confirm(t.profile.disconnectConfirm)) disconnect.mutate();
                }}
              >
                {t.profile.disconnectNutrition}
              </button>
            )}
            <button type="button" className="profile-action" data-kind="danger" onClick={() => signOut.mutate()}>
              {t.profile.signOut}
            </button>
          </div>
        </div>
      </div>
      {reminders && <RemindersSheet onClose={() => setReminders(false)} />}
    </div>
  );
}
