import type { ProfileView, TrainingSourceId } from "@intake/shared";
import { type ReactNode, useState } from "react";
import { Link } from "wouter";
import { useDisconnectNutrition, useHealthStatus, useLogWeight, useNutritionStatus, useProfile, useSetHealthSettings, useSignOut, type User, useSetTrainingSource, useTrainingSource, useHevySync, useHevySyncAction, useFeatures, useSetFeatures, useSetLanguage } from "../api/queries";
import { LANGUAGES, type FeatureKey } from "@intake/shared";
import { Avatar } from "../components/ProfileLink";
import { RemindersSheet } from "../components/RemindersSheet";
import { BackIcon } from "../components/icons";
import { formatClock, formatKcal, formatShortDate, formatWater, formatWeight, formatWeekdayDay } from "../lib/format";
import { LANGUAGE_NAMES, language, t } from "../lib/strings";
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
  const status = entries.length >= 2 ? null : latest ? t.profile.oneWeight(formatShortDate(latest.date), formatWeight(latest.weight)) : t.profile.noWeight;

  return (
    <section id="settings-weight" className="card profile-card settings-section" aria-label={t.profile.weight}>
      <div className="profile-card-head">
        <h2>{t.profile.weight}</h2>
        <span className="muted">{t.profile.weightCadence}</span>
      </div>
      <div className="weight-top">
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
      </div>
      {entries.length >= 2 && (
        <div className="weight-plot">
          <WeightChart entries={entries} target={target} />
        </div>
      )}
      {log.isSuccess && <p className="notice" data-kind="ok">{t.profile.logged}</p>}
      {log.isError && <p className="error-text">{t.profile.logFailed}</p>}
      <div className="weight-strip">
        {status && (
          <span className="weight-status">
            {latest && <span className="weight-dot" aria-hidden="true" />}
            {status}
          </span>
        )}
        <span className="muted" title={t.profile.weightHint}>
          {t.profile.weightHintShort}
        </span>
      </div>
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
    <section id="settings-goals" className="card profile-card profile-list settings-section" aria-label={t.profile.goals}>
      <div className="profile-card-head">
        <h2>{t.profile.goals}</h2>
        {goals && <span className="source-pill">{t.profile.goalsSource}</span>}
      </div>
      <div className="goal-grid">
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
      </div>
      {goals && <p className="muted settings-note">{t.profile.goalsNote}</p>}
    </section>
  );
}

type LinkState = "connected" | "warning" | "off" | "standby";

function ConnectionRow({ name, note, state, href, action }: { name: string; note: string; state: LinkState; href?: string; action?: ReactNode }) {
  const body = (
    <>
      <span className="connection-text">
        <strong>{name}</strong>
        <span className="muted">{note}</span>
      </span>
      <span className="connection-state">
        {action}
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

/** Hevy and openGym in Collegamenti: configured on the server or not, in use or not. */
function GymRows() {
  const data = useTrainingSource().data;
  if (!data) return null;
  const state = (id: TrainingSourceId): LinkState => (!data.available.includes(id) ? "off" : data.active === id ? "connected" : "standby");
  return (
    <>
      <ConnectionRow name={t.profile.hevy} note={data.available.includes("hevy") ? t.profile.hevyNote : t.profile.hevyMissing} state={state("hevy")} />
      <ConnectionRow name={t.profile.openGym} note={data.available.includes("opengym") ? t.profile.openGymNote : t.profile.openGymMissing} state={state("opengym")} />
    </>
  );
}

/** "Fonte delle schede" (Hevy | openGym), only when both are configured: one source at a time. */
function SourceRow() {
  const data = useTrainingSource().data;
  const setSource = useSetTrainingSource();
  if (!data || data.available.length < 2) return null;
  return (
    <div className="profile-row-item settings-row">
      <span className="connection-text">
        <strong id="training-source-label">{t.profile.trainingSource}</strong>
        <span className="muted">{setSource.isError ? t.profile.trainingSourceFailed : t.profile.trainingSourceNote}</span>
      </span>
      <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="training-source-label">
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
  );
}

/** Allenamenti: the workout source and the openGym → Hevy copy; hidden when neither applies. */
function TrainingCard() {
  const source = useTrainingSource().data;
  const sync = useHevySync().data;
  if (!(source && source.available.length > 1) && !sync?.available) return null;
  return (
    <section id="settings-training" className="card profile-card profile-list settings-section" aria-label={t.profile.nav.training}>
      <div className="profile-card-head">
        <h2>{t.profile.nav.training}</h2>
      </div>
      <SourceRow />
      <HevySyncRow />
    </section>
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
  const upToDate = data.enabled && last && !last.error && !action.isError && pending?.length === 0;
  return (
    <div className="profile-row-item hevy-sync">
      <div className="hevy-sync-head">
        <span className="connection-text">
          <strong id="hevy-sync-label">{s.title}</strong>
          <span className="muted">{upToDate ? s.upToDate(formatClock(last.at)) : note}</span>
        </span>
        <span className="hevy-sync-controls">
          {data.enabled && (
            <button type="button" className="button-secondary-small" disabled={action.isPending} onClick={() => action.mutate("run")}>
              {s.run}
            </button>
          )}
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-labelledby="hevy-sync-label"
            checked={data.enabled}
            disabled={action.isPending}
            onChange={(event) => {
              if (!event.target.checked) action.mutate("off");
              else if (window.confirm(s.confirm(pending?.length ?? 0))) action.mutate("on");
            }}
          />
        </span>
      </div>
      {pending === null ? (
        <span className="muted hevy-sync-hint">{s.unavailable}</span>
      ) : pending.length === 0 ? (
        !upToDate && <span className="muted hevy-sync-hint">{s.nothing}</span>
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
    </div>
  );
}

const FEATURE_ROWS: FeatureKey[] = ["training", "health", "reminders"];

/** Profilo › Funzioni (docs/features.md): Alimentazione always on, a switch for each optional part. */
function FeaturesCard() {
  const features = useFeatures();
  const save = useSetFeatures();
  const data = features.data;
  if (!data) return null;
  const s = t.profile.features;
  return (
    <section id="settings-features" className="card profile-card profile-list settings-section" aria-label={s.title}>
      <div className="profile-card-head">
        <h2>{s.title}</h2>
      </div>
      <div className="profile-row-item feature-row">
        <span className="connection-text">
          <strong>{s.nutrition}</strong>
          <span className="muted">{s.nutritionNote}</span>
        </span>
        <span className="state-pill" data-state="standby">{s.alwaysOn}</span>
      </div>
      {FEATURE_ROWS.map((key) => (
        <label key={key} className="profile-row-item feature-row">
          <span className="connection-text">
            <strong>{s[key]}</strong>
            <span className="muted">{s[`${key}Note`]}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={s.toggle(s[key])}
            checked={data[key]}
            disabled={save.isPending}
            onChange={(event) => save.mutate({ [key]: event.target.checked })}
          />
        </label>
      ))}
      <div className="profile-row-item feature-foot">
        <span className="muted feature-hint">{save.isError ? s.failed : s.hint}</span>
        <button type="button" className="button-secondary-small" disabled={save.isPending} onClick={() => save.mutate({ setupDone: false })}>
          {s.rerun}
        </button>
      </div>
    </section>
  );
}

type SectionId = "weight" | "goals" | "features" | "training" | "connections" | "reminders" | "appearance" | "account";

/** Section links on the left from desktop width (docs/design: Impostazioni · desktop / iPad); only sections on screen. */
function SectionNav({ sections }: { sections: SectionId[] }) {
  return (
    <nav className="settings-nav" aria-label={t.profile.sections}>
      {sections.map((id) => (
        <button key={id} type="button" className="settings-nav-link" onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {t.profile.nav[id]}
        </button>
      ))}
    </nav>
  );
}

/**
 * Impostazioni (route /profilo, docs/design Profilo and "Impostazioni · desktop / iPad"): one column of cards in a fixed
 * order (peso, obiettivi, funzioni, allenamenti, collegamenti, promemoria, aspetto e lingua, account), with section
 * links on the left from desktop width.
 */
export function ProfilePage({ user }: { user: User }) {
  const profile = useProfile();
  const health = useHealthStatus();
  const nutrition = useNutritionStatus(true);
  const source = useTrainingSource().data;
  const sync = useHevySync().data;
  const signOut = useSignOut();
  const disconnect = useDisconnectNutrition();
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const setLanguage = useSetLanguage();
  const [reminders, setReminders] = useState(false);
  const features = useFeatures().data;
  const data = profile.data;
  const healthState: LinkState = !health.data?.lastImport ? "off" : health.data.activeEnergyWarning ? "warning" : "connected";
  const showGoals = Boolean(data || health.data);
  const showTraining = Boolean(features?.training && ((source && source.available.length > 1) || sync?.available));

  const sections: SectionId[] = [
    ...(data ? (["weight"] as const) : []),
    ...(showGoals ? (["goals"] as const) : []),
    ...(features ? (["features"] as const) : []),
    ...(showTraining ? (["training"] as const) : []),
    "connections",
    ...(features?.reminders ? (["reminders"] as const) : []),
    "appearance",
    "account",
  ];

  return (
    <div className="page detail-page profile-page">
      <header className="profile-header">
        <Link href="/" className="icon-button profile-back" aria-label={t.profile.back}>
          <BackIcon />
        </Link>
        <Avatar user={user} className="avatar profile-avatar" />
        <div className="profile-heading">
          <h1>{t.profile.title}</h1>
          <span className="muted">{`${user.name ?? user.email} · ${t.profile.signedInGoogle}`}</span>
        </div>
      </header>

      <div className="settings-layout">
        <SectionNav sections={sections} />

        <div className="settings-main">
          {profile.isPending && <div className="card skeleton" style={{ height: 220 }} />}
          {profile.isError && <p className="notice" data-kind="error">{t.profile.loadFailed}</p>}
          {data && <WeightCard profile={data} />}
          {showGoals && <GoalsCard goals={data?.goals ?? null} stepGoal={health.data?.settings.stepGoal ?? null} />}

          <FeaturesCard />

          {features?.training && <TrainingCard />}

          <section id="settings-connections" className="card profile-card profile-list settings-section" aria-label={t.profile.connections}>
            <div className="profile-card-head">
              <h2>{t.profile.connections}</h2>
            </div>
            <ConnectionRow name={t.profile.google} note={t.profile.googleNote} state="connected" />
            <ConnectionRow
              name={t.profile.nutrition}
              note={t.profile.nutritionNote}
              state={nutrition.data?.connected === false ? "off" : "connected"}
              action={
                nutrition.data?.connected ? (
                  <button
                    type="button"
                    className="link-danger"
                    aria-label={t.profile.disconnectNutrition}
                    disabled={disconnect.isPending}
                    onClick={() => {
                      if (window.confirm(t.profile.disconnectConfirm)) disconnect.mutate();
                    }}
                  >
                    {t.profile.disconnect}
                  </button>
                ) : undefined
              }
            />
            {features?.health && (
              <ConnectionRow
                name={t.profile.appleHealth}
                note={healthState === "warning" ? `${t.profile.appleHealthNote} · ${t.profile.appleHealthWarning}` : t.profile.appleHealthNote}
                state={healthState}
                href="/profilo/salute"
              />
            )}
            {features?.training && <GymRows />}
          </section>

          {features?.reminders && (
            <section id="settings-reminders" className="card profile-card profile-list settings-section" aria-label={t.profile.reminders}>
              <div className="profile-card-head">
                <h2>{t.profile.reminders}</h2>
              </div>
              <button type="button" className="profile-row-item connection-row" onClick={() => setReminders(true)}>
                <span className="connection-text">
                  <strong>{t.profile.remindersNote}</strong>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </section>
          )}

          <section id="settings-appearance" className="card profile-card profile-list settings-section" aria-label={t.profile.nav.appearance}>
            <div className="profile-card-head">
              <h2>{t.profile.nav.appearance}</h2>
            </div>
            <div className="profile-row-item settings-row">
              <span className="connection-text">
                <strong id="theme-label">{t.profile.theme}</strong>
                <span className="muted">{t.profile.themeNote}</span>
              </span>
              <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="theme-label">
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
            </div>
            <div className="profile-row-item settings-row">
              <span className="connection-text">
                <strong id="language-label">{t.profile.language}</strong>
                <span className="muted">{setLanguage.isError ? t.profile.languageFailed : t.profile.languageNote}</span>
              </span>
              <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="language-label">
                {LANGUAGES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    lang={option}
                    aria-checked={(setLanguage.variables ?? language) === option}
                    className="segmented-option"
                    disabled={setLanguage.isPending}
                    onClick={() => option !== language && setLanguage.mutate(option)}
                  >
                    {LANGUAGE_NAMES[option]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section id="settings-account" className="card profile-card profile-list settings-section" aria-label={t.profile.nav.account}>
            <div className="profile-card-head">
              <h2>{t.profile.nav.account}</h2>
            </div>
            <div className="profile-row-item settings-row">
              <span className="connection-text">
                <strong>{user.email}</strong>
                <span className="muted">{t.profile.accountNote}</span>
              </span>
              <button type="button" className="button-secondary-small" data-kind="danger" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                {t.profile.signOut}
              </button>
            </div>
          </section>
        </div>
      </div>
      {reminders && <RemindersSheet onClose={() => setReminders(false)} />}
    </div>
  );
}
