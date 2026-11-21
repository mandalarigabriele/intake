import { MEAL_TYPES, PLAN_DIETS, WEEKDAYS, type PlanPreferences, type PlanSlot, type PlanViolation, type PlannedMeal, type Weekday } from "@intake/shared";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useActivatePlanDraft, usePlanGeneration, usePlanGenerationJob, useEditDraftMeal, useReplaceDraftMeal, useSavePlanPreferences, useSetDraftTime, useStartPlanGeneration, useSwapDraftMeal } from "../api/queries";
import { EditMeal, MoveMeal, PlanDayMeals, PlanDaySummary, SameTimeSwitch } from "../components/PlanDay";
import { ApiError } from "../api/client";
import { CloseIcon, SparklesIcon } from "../components/icons";
import { formatKcal } from "../lib/format";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";

const MAX_SLOTS = 7;
const splitTerms = (text: string) => text.split(",").map((term) => term.trim()).filter(Boolean);
const dayName = (weekday: (typeof WEEKDAYS)[number]) => t.weekdaysLong[WEEKDAYS.indexOf(weekday)]!;

function violationText(v: PlanViolation): string {
  const s = t.planGen;
  switch (v.kind) {
    case "allergen":
      return s.allergen(dayName(v.day), v.meal, v.term);
    case "disliked":
      return s.disliked(dayName(v.day), v.meal, v.term);
    case "repeated":
      return s.repeated(v.meal, v.times, v.max);
    case "sameDay":
      return s.sameDay(dayName(v.day), v.meal);
    case "freeMeal":
      return v.expected ? s.freeExpected(dayName(v.day), v.meal) : s.freeUnexpected(dayName(v.day), v.meal);
  }
}

/** The problems of one meal, in plain words, shown on the meal itself. */
function mealWarnings(violations: PlanViolation[], day: Weekday, index: number): string[] {
  const s = t.planGen;
  return violations.flatMap((v) => {
    if (v.kind === "repeated") return v.at.some((p) => p.day === day && p.index === index) ? [s.warnRepeated(v.times, v.max)] : [];
    if (v.day !== day || v.index !== index) return [];
    if (v.kind === "allergen") return [s.warnAllergen(v.term)];
    if (v.kind === "disliked") return [s.warnDisliked(v.term)];
    if (v.kind === "sameDay") return [s.warnSameDay];
    return [v.expected ? s.warnFreeExpected : s.warnFreeUnexpected];
  });
}

/** The first day a problem concerns, to jump there from the summary. */
const dayOf = (v: PlanViolation): Weekday => (v.kind === "repeated" ? (v.at[0]?.day ?? "monday") : v.day);

function Switch({ label, note, checked, onChange }: { label: string; note?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="profile-row-item setup-switch-row">
      <span className="connection-text">
        <strong>{label}</strong>
        {note && <span className="muted">{note}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/**
 * "Genera con l'IA" (Piano): preferences and constraints, the generation (a background job read every 2 s), then the
 * review with the day totals and the constraint checks, and "Attiva piano" as a new plan version. docs/plan-generation.md
 */
export function PlanGeneratePage() {
  const [, navigate] = useLocation();
  const view = usePlanGeneration();
  const save = useSavePlanPreferences();
  const start = useStartPlanGeneration();
  const activate = useActivatePlanDraft();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = usePlanGenerationJob(jobId);
  const [prefs, setPrefs] = useState<PlanPreferences | null>(null);
  const [allergies, setAllergies] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [day, setDay] = useState(0);
  const [validFrom, setValidFrom] = useState<string | null>(null);
  const [sameTime, setSameTime] = useState(true);
  // "Sostituisci": the meal whose wish field is open, and the wish
  const [replacing, setReplacing] = useState<{ day: Weekday; index: number } | null>(null);
  const [wish, setWish] = useState("");
  const setTime = useSetDraftTime(jobId ?? "");
  const replace = useReplaceDraftMeal(jobId ?? "");
  const swap = useSwapDraftMeal(jobId ?? "");
  const edit = useEditDraftMeal(jobId ?? "");

  useEffect(() => {
    if (!view.data || prefs) return;
    setPrefs(view.data.preferences);
    setAllergies(view.data.preferences.allergies.join(", "));
    setDislikes(view.data.preferences.dislikes.join(", "));
  }, [view.data, prefs]);

  const s = t.planGen;
  const status = job.data?.status;
  const draft = status === "done" ? job.data!.draft : null;

  const header = (
    <header className="edit-header edit-header-back">
      <Link href="/piano?vista=pasti" className="icon-button" aria-label={s.back}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </Link>
      <h1>{s.title}</h1>
      <span aria-hidden="true" />
    </header>
  );

  // ── Generating ─────────────────────────────────────────
  if (jobId && (status === "running" || !job.data)) {
    const data = job.data;
    const label = !data || data.daysDone === 0 ? s.generatingStart : data.round > 1 ? s.correcting : s.generatingDay(t.weekdaysLong[Math.min(6, data.daysDone)]!.toLowerCase());
    return (
      <div className="page detail-page edit-page plan-gen-page">
        {header}
        <div className="card recognize-wait" aria-live="polite" aria-busy="true">
          <span className="recognize-spinner" aria-hidden="true" />
          <strong>{label}</strong>
          <div className="plan-gen-progress" aria-hidden="true">
            <span style={{ width: `${((data?.daysDone ?? 0) / 7) * 100}%` }} />
          </div>
          <span className="muted">{s.generatingNote}</span>
        </div>
      </div>
    );
  }

  // ── Review ─────────────────────────────────────────────
  if (draft && jobId) {
    const weekday = WEEKDAYS[day]!;
    const check = draft.checks.days[day]!;
    const from = validFrom ?? draft.plan.validFrom;
    const statusOf = (c: typeof check) => (c.hasFreeMeal ? s.freeDay : c.onTarget === false ? s.offTarget : s.onTarget);
    const offDays = draft.checks.days.filter((d) => d.onTarget === false);
    const hasIssues = offDays.length > 0 || draft.checks.violations.length > 0;
    const goTo = (w: Weekday) => {
      setDay(WEEKDAYS.indexOf(w));
      setReplacing(null);
    };
    const busyIndex = replace.isPending && replace.variables?.day === weekday ? replace.variables.index : null;
    const replaceControl = (meal: PlannedMeal, index: number) => {
        if (busyIndex === index) {
          return (
            <p className="plan-meal-busy" aria-live="polite">
              <span className="recognize-spinner" aria-hidden="true" /> {s.replacing}
            </p>
          );
        }
        const open = replacing?.day === weekday && replacing.index === index;
        if (!open) {
          return (
            <button
              type="button"
              className="plan-meal-action"
              disabled={replace.isPending}
              aria-label={s.replaceOf(meal.title)}
              onClick={() => {
                setReplacing({ day: weekday, index });
                setWish("");
                replace.reset();
              }}
            >
              <SparklesIcon size={14} />
              {s.replace}
            </button>
          );
        }
        return (
          <form
            className="plan-replace"
            onSubmit={(e) => {
              e.preventDefault();
              replace.mutate({ day: weekday, index, note: wish.trim() }, { onSuccess: () => setReplacing(null) });
            }}
          >
            <label className="field">
              <span>{s.replaceNote}</span>
              <input value={wish} maxLength={200} placeholder={s.replacePlaceholder} autoFocus onChange={(e) => setWish(e.target.value)} />
            </label>
            {replace.isError && <p className="error-text">{planErrorText(replace.error)}</p>}
            <div className="plan-replace-actions">
              <button type="button" className="button-secondary-small" onClick={() => setReplacing(null)}>
                {s.cancel}
              </button>
              <button type="submit" className="button-primary-inline button-ai">
                <SparklesIcon size={16} />
                {s.replace}
              </button>
            </div>
          </form>
        );
    };
    const moveControl = (index: number) => (
      <MoveMeal plan={draft.plan} day={weekday} index={index} busy={swap.isPending || replace.isPending} failed={swap.isError} onMove={(toDay) => swap.mutate({ day: weekday, index, toDay })} />
    );
    return (
      <div className="page detail-page edit-page plan-gen-page plan-gen-review">
        {header}

        {hasIssues ? (
          <section className="card plan-gen-issues" aria-labelledby="plan-gen-issues-title">
            <strong id="plan-gen-issues-title">
              <span aria-hidden="true">⚠</span> {s.issuesTitle}
            </strong>
            <p className="muted">{s.issuesBody}</p>
            <ul>
              {offDays.length > 0 && (
                <li>
                  {s.issueDays}{" "}
                  {offDays.map((d, i) => (
                    <span key={d.day}>
                      {i > 0 && ", "}
                      <button type="button" className="text-button" onClick={() => goTo(d.day)}>
                        {dayName(d.day).toLowerCase()}
                      </button>
                    </span>
                  ))}
                </li>
              )}
              {draft.checks.violations.map((v, i) => (
                <li key={i}>
                  <button type="button" className="text-button" onClick={() => goTo(dayOf(v))}>
                    {violationText(v)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="notice" data-kind="ok">
            ✓ {s.allGood}
          </p>
        )}
        {draft.rounds > 1 && <p className="sheet-note">{s.corrected}</p>}

        <div className="plan-layout">
          <div className="plan-tabs" role="tablist" aria-label={t.plan.daysTabs}>
            {WEEKDAYS.map((w, i) => {
              const c = draft.checks.days[i]!;
              return (
                <button key={w} type="button" role="tab" aria-selected={i === day} className="plan-tab" data-off={c.onTarget === false || undefined} data-free={c.hasFreeMeal || undefined} aria-label={`${t.weekdaysLong[i]} · ${statusOf(c)}`} onClick={() => goTo(w)}>
                  <span className="plan-tab-letter">{t.weekdaysShort[i]}</span>
                  <span className="plan-gen-mark" aria-hidden="true">
                    {c.onTarget === false ? "!" : c.hasFreeMeal ? "–" : "✓"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="plan-day" role="tabpanel">
            <div className="plan-day-head">
              <h2>{t.weekdaysLong[day]}</h2>
              <span className="state-pill" data-state={check.onTarget === false ? "warning" : "connected"}>
                {statusOf(check)}
              </span>
            </div>
            {draft.plan.days[weekday].note && <p className="muted plan-day-note">{draft.plan.days[weekday].note}</p>}
            <PlanDayMeals
              day={draft.plan.days[weekday]}
              timeBusy={setTime.isPending}
              onTime={(index, time) => setTime.mutate({ day: weekday, index, time, allDays: sameTime })}
              warnings={(index) => mealWarnings(draft.checks.violations, weekday, index)}
              busyIndex={busyIndex}
              extra={(meal, index) => (
                <div className="plan-meal-actions">
                  <EditMeal meal={meal} busy={edit.isPending || replace.isPending} failed={edit.isError} onSave={(dish, done) => edit.mutate({ day: weekday, index, ...dish }, { onSuccess: done })} />
                  {!meal.free && replaceControl(meal, index)}
                  {moveControl(index)}
                </div>
              )}
            />
          </div>

          <aside className="plan-aside">
            <PlanDaySummary day={draft.plan.days[weekday]} goals={draft.targets} />
            <section className="card plan-times">
              <SameTimeSwitch checked={sameTime} onChange={setSameTime} />
              <p className="muted">{t.plan.timeHint}</p>
              {setTime.isError && <p className="error-text">{t.plan.timeFailed}</p>}
            </section>
            {draft.plan.notes && draft.plan.notes.length > 0 && (
              <details className="plan-notes" open>
                <summary>{t.plan.notes}</summary>
                <ul>
                  {draft.plan.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
        </div>

        <p className="sheet-note">{s.disclaimer}</p>
        <div className="form-card plan-gen-activate">
          <label className="form-row">
            <span>{s.activateFrom}</span>
            <input type="date" value={from} onChange={(e) => setValidFrom(e.target.value)} aria-label={s.activateFrom} />
          </label>
        </div>
        {activate.isError && <p className="error-text">{s.activateFailed}</p>}
        <div className="detail-actions plan-gen-actions">
          <button type="button" className="button-secondary" disabled={activate.isPending || replace.isPending} onClick={() => setJobId(null)}>
            {s.editPreferences}
          </button>
          <button type="button" className="button-primary-inline" disabled={activate.isPending || replace.isPending || !from} onClick={() => activate.mutate({ id: jobId, validFrom: from }, { onSuccess: () => navigate("/piano?vista=pasti") })}>
            {s.activate}
          </button>
        </div>
      </div>
    );
  }

  // ── Preferences ────────────────────────────────────────
  if (!view.data || !prefs) {
    return (
      <div className="page detail-page edit-page plan-gen-page">
        {header}
        <div className="card skeleton" style={{ height: 320 }} />
      </div>
    );
  }
  const targets = view.data.targets;
  const update = (patch: Partial<PlanPreferences>) => setPrefs({ ...prefs, ...patch });
  const setSlot = (index: number, patch: Partial<PlanSlot>) => update({ slots: prefs.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)) });
  const failed = status === "failed" ? planErrorText(new ApiError(502, job.data?.error ?? "recognition_failed", "plan generation failed")) : null;
  const startError = start.error instanceof ApiError && start.error.code === "generation_running" ? s.running : start.isError || save.isError ? s.startFailed : null;

  function generate() {
    if (!prefs) return;
    const next: PlanPreferences = { ...prefs, allergies: splitTerms(allergies), dislikes: splitTerms(dislikes) };
    save.mutate(next, {
      onSuccess: () =>
        start.mutate(undefined, {
          onSuccess: ({ id }) => {
            setDay(0);
            setValidFrom(null);
            setJobId(id);
          },
        }),
    });
  }

  return (
    <div className="page detail-page edit-page plan-gen-page">
      {header}
      <p className="sheet-note">{s.disclaimer}</p>

      <span className="sheet-section">{s.targets}</span>
      <div className="form-card plan-gen-targets">
        {targets.kcal !== null ? (
          <strong>{s.targetsLine(formatKcal(targets.kcal), formatKcal(targets.protein ?? 0), formatKcal(targets.carbs ?? 0), formatKcal(targets.fat ?? 0))}</strong>
        ) : (
          <span className="muted">{s.targetsMissing}</span>
        )}
        <Link href="/piano?vista=fabbisogno" className="activity-more">
          {s.targetsEdit}
        </Link>
      </div>

      <span className="sheet-section">{s.slots}</span>
      <div className="form-card">
        {prefs.slots.map((slot, i) => (
          <div key={slot.id} className="plan-gen-slot">
            <input className="note-input" value={slot.label} maxLength={30} aria-label={`${s.slotLabel} ${i + 1}`} onChange={(e) => setSlot(i, { label: e.target.value })} />
            <input type="time" value={slot.time} aria-label={`${s.slotTime} · ${slot.label}`} onChange={(e) => setSlot(i, { time: e.target.value })} />
            <select value={slot.type} aria-label={`${s.slotType} · ${slot.label}`} onChange={(e) => setSlot(i, { type: e.target.value as PlanSlot["type"] })}>
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t.mealTypes[type]}
                </option>
              ))}
            </select>
            <button type="button" className="item-remove" aria-label={s.slotRemove(slot.label)} disabled={prefs.slots.length <= 1} onClick={() => update({ slots: prefs.slots.filter((_, j) => j !== i), freeMeals: prefs.freeMeals.filter((f) => f.slot !== slot.id) })}>
              <CloseIcon size={18} strokeWidth={2.2} />
            </button>
          </div>
        ))}
        {prefs.slots.length < MAX_SLOTS && (
          <button type="button" className="text-button text-button-strong add-food" onClick={() => update({ slots: [...prefs.slots, { id: `slot-${Date.now().toString(36)}`, label: t.mealTypes.snack!, time: "17:00", type: "snack" }] })}>
            {s.slotAdd}
          </button>
        )}
      </div>

      <span className="sheet-section">{s.freeMeals}</span>
      <div className="form-card">
        {WEEKDAYS.map((w, i) => {
          const current = prefs.freeMeals.find((f) => f.day === w)?.slot ?? "";
          return (
            <label key={w} className="form-row">
              <span>{t.weekdaysLong[i]}</span>
              <select value={current} onChange={(e) => update({ freeMeals: [...prefs.freeMeals.filter((f) => f.day !== w), ...(e.target.value ? [{ day: w, slot: e.target.value }] : [])] })}>
                <option value="">{s.freeNone}</option>
                {prefs.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {`${slot.label} · ${slot.time}`}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <p className="sheet-note">{s.freeMealsHint}</p>

      <span className="sheet-section">{s.variety}</span>
      <div className="form-card">
        <div className="profile-row-item settings-row backup-row">
          <span className="connection-text">
            <strong>{s.maxSame}</strong>
            <span className="muted">{s.maxSameValue(prefs.maxSameMealPerWeek)}</span>
          </span>
          <div className="stepper stepper-sm">
            <button type="button" aria-label={`${s.less} · ${s.maxSame}`} disabled={prefs.maxSameMealPerWeek <= 1} onClick={() => update({ maxSameMealPerWeek: prefs.maxSameMealPerWeek - 1 })}>
              −
            </button>
            <span aria-live="polite">{prefs.maxSameMealPerWeek}</span>
            <button type="button" aria-label={`${s.more} · ${s.maxSame}`} disabled={prefs.maxSameMealPerWeek >= 7} onClick={() => update({ maxSameMealPerWeek: prefs.maxSameMealPerWeek + 1 })}>
              +
            </button>
          </div>
        </div>
        <Switch label={s.noRepeatSameDay} checked={prefs.noRepeatSameDay} onChange={(v) => update({ noRepeatSameDay: v })} />
        <Switch label={s.sameBreakfast} checked={prefs.sameBreakfastOk} onChange={(v) => update({ sameBreakfastOk: v })} />
      </div>

      <span className="sheet-section">{s.food}</span>
      <div className="segmented" role="radiogroup" aria-label={s.diet}>
        {PLAN_DIETS.map((diet) => (
          <button key={diet} type="button" role="radio" aria-checked={prefs.diet === diet} className="segmented-option" onClick={() => update({ diet })}>
            {s.diets[diet]}
          </button>
        ))}
      </div>
      <div className="form-card plan-gen-fields">
        <label className="field">
          <span>{s.allergies}</span>
          <input value={allergies} maxLength={400} placeholder={s.allergiesPlaceholder} onChange={(e) => setAllergies(e.target.value)} />
        </label>
        <span className="muted">{s.allergiesHint}</span>
        <label className="field">
          <span>{s.dislikes}</span>
          <input value={dislikes} maxLength={400} placeholder={s.dislikesPlaceholder} onChange={(e) => setDislikes(e.target.value)} />
        </label>
        <span className="muted">{s.dislikesHint}</span>
      </div>

      <span className="sheet-section">{s.cooking}</span>
      <div className="form-card">
        <div className="profile-row-item settings-row backup-row">
          <span className="connection-text">
            <strong>{s.cookingMinutes}</strong>
            <span className="muted">{prefs.cookingMinutes === null ? s.cookingAny : s.cookingValue(prefs.cookingMinutes)}</span>
          </span>
          <div className="stepper stepper-sm">
            <button type="button" aria-label={`${s.less} · ${s.cookingMinutes}`} disabled={prefs.cookingMinutes !== null && prefs.cookingMinutes <= 10} onClick={() => update({ cookingMinutes: prefs.cookingMinutes === null ? 60 : prefs.cookingMinutes - 10 })}>
              −
            </button>
            <span aria-live="polite">{prefs.cookingMinutes ?? "∞"}</span>
            <button type="button" aria-label={`${s.more} · ${s.cookingMinutes}`} disabled={prefs.cookingMinutes === null} onClick={() => update({ cookingMinutes: prefs.cookingMinutes! >= 90 ? null : prefs.cookingMinutes! + 10 })}>
              +
            </button>
          </div>
        </div>
        <Switch label={s.leftovers} note={s.leftoversNote} checked={prefs.leftovers} onChange={(v) => update({ leftovers: v })} />
        <Switch label={s.seasonal} checked={prefs.seasonal} onChange={(v) => update({ seasonal: v })} />
        <Switch label={s.learn} note={s.learnNote} checked={prefs.learnFromMeals} onChange={(v) => update({ learnFromMeals: v })} />
      </div>

      <div className="form-card plan-gen-fields">
        <label className="field">
          <span>{s.notes}</span>
          <textarea value={prefs.notes} rows={3} maxLength={1000} placeholder={s.notesPlaceholder} onChange={(e) => update({ notes: e.target.value })} />
        </label>
      </div>
      <p className="sheet-note">{s.privacy}</p>

      {failed && <p className="notice" data-kind="error">{failed}</p>}
      {startError && <p className="notice" data-kind="error">{startError}</p>}
      <button type="button" className="button-primary button-ai" disabled={save.isPending || start.isPending || prefs.slots.some((slot) => !slot.label.trim())} onClick={generate}>
        <SparklesIcon size={18} />
        {s.generate}
      </button>
    </div>
  );
}
