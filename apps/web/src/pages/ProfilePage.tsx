import type { ProfileView, TrainingSourceId } from "@intake/shared";
import { Fragment, type ReactNode, useState } from "react";
import { Link } from "wouter";
import { useDisconnectNutrition, useHealthStatus, useLogWeight, useNutritionStatus, useProfile, useSetHealthSettings, useRecognitionModel, useSetRecognitionModel, usePlanGeneration, useSetPlanModel, useSignOut, type User, useSetTrainingSource, useTrainingSource, useHevySync, useHevySyncAction, useFeature, useFeatures, useSetFeatures, useSetLanguage, useSetGoals, useBackups, useBackupAction } from "../api/queries";
import { BACKUP_KEEP, LANGUAGES, parseGoalInput, weightUnitOf, type FeatureKey, type GoalsUpdate, type WeightUnit } from "@intake/shared";
import { Avatar } from "../components/ProfileLink";
import { RemindersSheet } from "../components/RemindersSheet";
import { BackIcon, SparklesIcon } from "../components/icons";
import { formatClock, formatDayLongMonth, formatMegabytes, formatKcal, formatOneDecimal, formatShortDate, formatWater, formatWeight, formatWeekdayDay } from "../lib/format";
import { LANGUAGE_NAMES, language, t } from "../lib/strings";
import { exerciseName } from "./TrainingPage";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
import { preferredPlanTab, setPreferredPlanTab, type PlanTab } from "../lib/planTab";

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

type GoalField = "kcal" | "protein" | "carbs" | "fat" | "fiber" | "water" | "targetWeight";

/** What a field shows when editing: kcal and grams as integers, water in liters, the target weight with one decimal. */
function fieldText(key: GoalField, goals: ProfileView["goals"], targetWeight: number | null): string {
  const value = key === "water" ? goals.waterMl : key === "targetWeight" ? targetWeight : goals[key];
  if (value === null) return "";
  if (key === "water") return formatOneDecimal(value / 1000);
  if (key === "targetWeight") return formatWeight(value);
  return String(Math.round(value));
}

function GoalsCard({
  goals,
  targetWeight,
  weightUnit,
  stepGoal,
}: {
  goals: ProfileView["goals"] | null;
  targetWeight: number | null;
  /** The unit of the Nutrition profile, used for the target weight label and when saving it. */
  weightUnit: WeightUnit;
  stepGoal: number | null;
}) {
  const setGoals = useSetGoals();
  // While the Acqua part is off the water goal is neither shown nor edited (it stays in Nutrition)
  const water = useFeature("water");
  const [draft, setDraft] = useState<Record<GoalField, string> | null>(null);
  const [invalid, setInvalid] = useState(false);
  const names = t.profile.goalNames;
  const grams = (v: number | null) => (v === null ? t.profile.notSet : `${formatKcal(v)} g`);
  const rows: Array<{ key: GoalField; label: string; value: string; unit: string; decimals: boolean }> = goals
    ? [
        { key: "kcal", label: names.kcal, value: goals.kcal === null ? t.profile.notSet : `${formatKcal(goals.kcal)} kcal`, unit: "kcal", decimals: false },
        { key: "protein", label: names.protein, value: grams(goals.protein), unit: "g", decimals: false },
        { key: "carbs", label: names.carbs, value: grams(goals.carbs), unit: "g", decimals: false },
        { key: "fat", label: names.fat, value: grams(goals.fat), unit: "g", decimals: false },
        { key: "fiber", label: names.fiber, value: grams(goals.fiber), unit: "g", decimals: false },
        ...(water
          ? [{ key: "water" as const, label: names.water, value: goals.waterMl === null ? t.profile.notSet : formatWater(goals.waterMl), unit: "L", decimals: true }]
          : []),
      ]
    : [];
  // The target weight is shown in Peso; it is edited here with the goals, since Nutrition keeps it with them
  const editRows = [...rows, { key: "targetWeight" as const, label: t.profile.targetWeight, value: "", unit: weightUnit, decimals: true }];

  const startEditing = () => {
    if (!goals) return;
    setDraft(Object.fromEntries(editRows.map((row) => [row.key, fieldText(row.key, goals, targetWeight)])) as Record<GoalField, string>);
    setInvalid(false);
    setGoals.reset();
  };

  const save = () => {
    if (!goals || !draft) return;
    const update: GoalsUpdate = {};
    for (const row of editRows) {
      const text = draft[row.key];
      // Only what changed is sent, so a goal set elsewhere in the meantime is not overwritten
      if (text === fieldText(row.key, goals, targetWeight)) continue;
      // Calories and grams read "2.200" as 2200; out-of-range values are refused, not saved
      const value = parseGoalInput(row.key === "water" ? "waterL" : row.key, text, weightUnit);
      if (value === undefined) {
        setInvalid(true);
        return;
      }
      if (row.key === "water") update.waterMl = value === null ? null : Math.round(value * 1000);
      else if (row.key === "targetWeight") {
        update.targetWeight = value === null ? null : Math.round(value * 10) / 10;
        update.weightUnit = weightUnit;
      }
      else update[row.key] = value === null ? null : Math.round(value);
    }
    setInvalid(false);
    if (Object.keys(update).length === 0) {
      setDraft(null);
      return;
    }
    setGoals.mutate(update, { onSuccess: () => setDraft(null) });
  };

  return (
    <section id="settings-goals" className="card profile-card profile-list settings-section" aria-label={t.profile.goals}>
      <div className="profile-card-head">
        <h2>{t.profile.goals}</h2>
        {goals && !draft && (
          <span className="goals-head-actions">
            <span className="source-pill">{t.profile.goalsSource}</span>
            <button type="button" className="text-button text-button-strong" onClick={startEditing}>
              {t.profile.goalsEdit}
            </button>
          </span>
        )}
      </div>
      {draft ? (
        <form
          className="goals-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="goal-grid">
            {editRows.map((row) => (
              <label key={row.key} className="profile-row-item goal-row" data-goal={row.key}>
                <span className="goal-name">
                  <span className="goal-swatch" aria-hidden="true" />
                  {row.label}
                </span>
                <span className="goal-input">
                  <input
                    value={draft[row.key]}
                    onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                    inputMode={row.decimals ? "decimal" : "numeric"}
                    enterKeyHint="done"
                    placeholder={t.profile.notSet}
                    aria-label={`${row.label} (${row.unit})`}
                  />
                  <span className="muted">{row.unit}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="muted settings-note">{t.profile.goalsHint}</p>
          {invalid && <p className="notice" data-kind="error">{t.profile.goalsInvalid}</p>}
          {setGoals.isError && <p className="notice" data-kind="error">{t.profile.goalsFailed}</p>}
          <div className="goals-actions">
            <button type="button" className="button button-secondary" onClick={() => setDraft(null)} disabled={setGoals.isPending}>
              {t.profile.goalsCancel}
            </button>
            <button type="submit" className="button" disabled={setGoals.isPending}>
              {t.profile.goalsSave}
            </button>
          </div>
        </form>
      ) : (
        <>
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
          {setGoals.isSuccess && (
            <p className="notice" data-kind="ok">
              {t.profile.goalsSaved}
            </p>
          )}
          {goals && <p className="muted settings-note">{t.profile.goalsNote}</p>}
        </>
      )}
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

const FEATURE_ROWS: FeatureKey[] = ["photoMeals", "water", "training", "health", "reminders"];

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
        <Fragment key={key}>
          <label className="profile-row-item feature-row">
            <span className="connection-text">
              <strong className={key === "photoMeals" ? "ai-label" : undefined}>
                {key === "photoMeals" && <SparklesIcon size={16} />}
                {s[key]}
              </strong>
              <span className="muted">{key === "photoMeals" && !data.recognitionConfigured ? s.photoMealsMissing : s[`${key}Note`]}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              aria-label={s.toggle(s[key])}
              checked={data[key]}
              disabled={save.isPending || (key === "photoMeals" && !data.recognitionConfigured && !data[key])}
              onChange={(event) => save.mutate({ [key]: event.target.checked })}
            />
          </label>
          {/* The model sits right under its switch, only while the part is on and the key is set */}
          {key === "photoMeals" && data.photoMeals && data.recognitionConfigured && <RecognitionModelRow />}
          {key === "photoMeals" && data.photoMeals && data.recognitionConfigured && <PlanModelRow />}
        </Fragment>
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

/** "Haiku 5.5" for claude-haiku-5-5; other model ids as they are. */
function modelName(id: string): string {
  const match = /^claude-(haiku|sonnet|opus)-(\d+)-(\d+)$/.exec(id);
  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}` : id;
}

/** Pasti da foto › Modello: Haiku (default, cheaper) or Sonnet, for the next recognitions of the installation. */
function RecognitionModelRow() {
  const model = useRecognitionModel(true);
  const save = useSetRecognitionModel();
  const s = t.profile.features;
  if (!model.data) return null;
  const current = save.variables ?? model.data.model;
  return (
    <div className="profile-row-item settings-row recognition-model-row">
      <span className="connection-text">
        <strong id="recognition-model-label" className="ai-label">
          <SparklesIcon size={16} />
          {s.recognitionModel}
        </strong>
        <span className="muted">{save.isError ? s.recognitionModelFailed : s.recognitionModelNote}</span>
      </span>
      <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="recognition-model-label">
        {model.data.models.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={current === option}
            className="segmented-option"
            disabled={save.isPending}
            onClick={() => option !== model.data.model && save.mutate(option)}
          >
            {modelName(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pasti da foto › Modello per i piani: Sonnet (default), Opus or Haiku for "Genera con l'IA" in Piano. */
function PlanModelRow() {
  const view = usePlanGeneration();
  const save = useSetPlanModel();
  const s = t.planGen;
  if (!view.data) return null;
  const current = save.variables ?? view.data.model;
  return (
    <div className="profile-row-item settings-row recognition-model-row">
      <span className="connection-text">
        <strong id="plan-model-label" className="ai-label">
          <SparklesIcon size={16} />
          {s.modelRow}
        </strong>
        <span className="muted">{save.isError ? s.modelFailed : s.modelNote}</span>
      </span>
      <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="plan-model-label">
        {view.data.models.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={current === option} className="segmented-option" disabled={save.isPending} onClick={() => option !== view.data.model && save.mutate(option)}>
            {modelName(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Backups listed before "Mostra altri". */
const BACKUPS_SHOWN = 3;

/** Impostazioni › Backup (docs/backups.md): the daily Nutrition exports saved on the server, to download. */
function BackupCard() {
  const backups = useBackups();
  const action = useBackupAction();
  const data = backups.data;
  if (!data) return null;
  const s = t.profile.backups;
  const running = data.running || (action.isPending && "run" in (action.variables ?? {}));
  const keep = (delta: number) => {
    const next = Math.min(BACKUP_KEEP.max, Math.max(BACKUP_KEEP.min, data.keep + delta));
    if (next !== data.keep) action.mutate({ keep: next });
  };
  const row = (file: (typeof data.files)[number]) => {
    const day = formatDayLongMonth(file.date);
    return (
      <div key={file.name} className="profile-row-item settings-row backup-row">
        <span className="connection-text">
          <strong>{`${day} · ${formatClock(file.createdAt)}`}</strong>
          <span className="muted">{formatMegabytes(file.size)}</span>
        </span>
        <a className="button-secondary-small" href={`/api/backups/${encodeURIComponent(file.name)}`} download aria-label={s.downloadLabel(day)}>
          {s.download}
        </a>
      </div>
    );
  };
  const older = data.files.slice(BACKUPS_SHOWN);
  return (
    <section id="settings-backup" className="card profile-card profile-list settings-section" aria-label={s.title}>
      <div className="profile-card-head">
        <h2>{s.title}</h2>
      </div>
      <p className="muted settings-note backup-note">{s.note}</p>
      {data.lastRun?.error && (
        <p className="notice" data-kind="error">
          {s.failed(formatClock(data.lastRun.at), s.reasons[data.lastRun.error] ?? s.reasons.failed!)}
        </p>
      )}
      {data.files.length === 0 ? (
        <p className="muted settings-note">{s.empty}</p>
      ) : (
        <>
          {data.files.slice(0, BACKUPS_SHOWN).map(row)}
          {older.length > 0 && (
            <details className="backup-older">
              <summary>{s.more(older.length)}</summary>
              {older.map(row)}
            </details>
          )}
        </>
      )}
      <div className="profile-row-item settings-row backup-row">
        <span className="connection-text">
          <strong>{s.keep}</strong>
          <span className="muted">{s.keepNote}</span>
        </span>
        <div className="stepper stepper-sm">
          <button type="button" aria-label={s.keepLess} disabled={data.keep <= BACKUP_KEEP.min || action.isPending} onClick={() => keep(-1)}>
            −
          </button>
          <span aria-live="polite">{data.keep}</span>
          <button type="button" aria-label={s.keepMore} disabled={data.keep >= BACKUP_KEEP.max || action.isPending} onClick={() => keep(1)}>
            +
          </button>
        </div>
      </div>
      <div className="profile-row-item feature-foot">
        <button type="button" className="button-secondary-small" disabled={running} onClick={() => action.mutate({ run: true })}>
          {running ? s.running : s.run}
        </button>
      </div>
    </section>
  );
}

type SectionId = "weight" | "goals" | "features" | "training" | "connections" | "backup" | "reminders" | "appearance" | "account";

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
  const [planTab, setPlanTab] = useState<PlanTab>(preferredPlanTab);
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
    "backup",
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
          {showGoals && <GoalsCard goals={data?.goals ?? null} targetWeight={data?.weight.target ?? null} weightUnit={weightUnitOf(data?.weight.unit)} stepGoal={health.data?.settings.stepGoal ?? null} />}

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

          <BackupCard />

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
                <strong id="plan-tab-label">{t.profile.planTab}</strong>
                <span className="muted">{t.profile.planTabNote}</span>
              </span>
              <div className="segmented settings-segmented" role="radiogroup" aria-labelledby="plan-tab-label">
                {(["plan", "needs"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={planTab === option}
                    className="segmented-option"
                    onClick={() => {
                      setPlanTab(option);
                      setPreferredPlanTab(option);
                    }}
                  >
                    {t.plan.tabs[option]}
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
