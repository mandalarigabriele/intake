import { WEEKDAYS, foodLine, isFixedMeal, type MealPlan, type PlannedDay, type PlannedFood, type PlannedMeal, type StoredPlan, type Weekday } from "@intake/shared";
import { useEffect, useState, type ReactNode } from "react";
import { useAlternativeMeal, useConfirmSplitFoods, useConfirmSplitWeek, useEstimateMacros, useFeatures, useSplitFoodsProposal, useSplitWeekProposal } from "../api/queries";
import { formatKcal } from "../lib/format";
import { ApiError } from "../api/client";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";
import { FoodPicker } from "./FoodPicker";
import { SparklesIcon } from "./icons";

export interface PlanGoals {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

/** Calories within this share of the goal count as on target, as in the plan checks. */
const KCAL_TOLERANCE = 0.07;
/** Grams below or above a macro goal that still count as on target. */
const GRAMS_TOLERANCE = 10;

/** Sum of the planned nutrients of a day; free meals have none. */
export function dayNutrients(day: PlannedDay) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, known: false, hasFree: false };
  for (const meal of day.meals) {
    if (!isFixedMeal(meal)) {
      sum.hasFree = true;
      continue;
    }
    if (!meal.macros) continue;
    sum.known = true;
    sum.kcal += meal.macros.kcal;
    sum.protein += meal.macros.protein;
    sum.carbs += meal.macros.carbs;
    sum.fat += meal.macros.fat;
    sum.fiber += meal.macros.fiber ?? 0;
  }
  return sum;
}

/** A time that is saved when the field is left (the picker sends a change for every wheel step on some browsers). */
function TimeField({ meal, onCommit, disabled }: { meal: PlannedMeal; onCommit: (time: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(meal.time ?? "");
  useEffect(() => setValue(meal.time ?? ""), [meal.time]);
  const commit = () => {
    if (/^\d{2}:\d{2}$/.test(value) && value !== meal.time) onCommit(value);
    else setValue(meal.time ?? "");
  };
  return (
    <input
      type="time"
      className="plan-time plan-time-edit"
      value={value}
      disabled={disabled}
      aria-label={t.plan.timeOf(meal.title)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export interface PlanDayMealsProps {
  day: PlannedDay;
  /** Present when times can be changed (draft or stored plan). */
  onTime?: (index: number, time: string) => void;
  timeBusy?: boolean;
  /** Plain-language problems of a meal (review of a generated plan). */
  warnings?: (index: number) => string[];
  /** Extra content under a meal, e.g. Sostituisci. */
  extra?: (meal: PlannedMeal, index: number) => ReactNode;
  /** A meal being replaced is dimmed. */
  busyIndex?: number | null;
}

/** The meals of one plan day: time (editable), name, kcal, dish, foods and macros. Used by Piano and the AI review. */
export function PlanDayMeals({ day, onTime, timeBusy, warnings, extra, busyIndex }: PlanDayMealsProps) {
  return (
    <div className="plan-meals">
      {day.meals.map((meal, i) => {
        const problems = warnings?.(i) ?? [];
        const time = onTime ? <TimeField meal={meal} disabled={timeBusy} onCommit={(value) => onTime(i, value)} /> : meal.time && <span className="plan-time">{meal.time}</span>;
        if (!isFixedMeal(meal)) {
          return (
            <article key={i} className="plan-meal" data-free data-warn={problems.length > 0 || undefined}>
              <header>
                {time}
                <h3>{meal.title}</h3>
                <span className="free-badge">{t.plan.freeBadge}</span>
              </header>
              {meal.description && <p className="plan-meal-dish">{meal.description}</p>}
              {problems.map((text, j) => (
                <p key={j} className="plan-meal-warn">
                  <span aria-hidden="true">⚠</span> {text}
                </p>
              ))}
              {extra?.(meal, i)}
            </article>
          );
        }
        const m = meal.macros;
        return (
          <article key={i} className="plan-meal" data-warn={problems.length > 0 || undefined} aria-busy={busyIndex === i || undefined}>
            <header>
              {time}
              <h3>{meal.title}</h3>
              {m && <span className="plan-meal-kcal">{formatKcal(m.kcal)} kcal</span>}
            </header>
            {meal.description && <p className="plan-meal-dish">{meal.description}</p>}
            <ul>
              {meal.foods.map((food, j) => (
                <li key={j}>{foodLine(food)}</li>
              ))}
            </ul>
            {m && <p className="plan-meal-macros">{t.plan.macroLine(formatKcal(m.protein), formatKcal(m.carbs), formatKcal(m.fat), formatKcal(m.fiber ?? 0))}</p>}
            {problems.map((text, j) => (
              <p key={j} className="plan-meal-warn">
                <span aria-hidden="true">⚠</span> {text}
              </p>
            ))}
            {extra?.(meal, i)}
          </article>
        );
      })}
    </div>
  );
}

function stateOf(value: number, goal: number, tolerance: number): { state: "ok" | "over" | "under"; text: string } {
  const diff = Math.round(value - goal);
  if (Math.abs(diff) <= tolerance) return { state: "ok", text: t.plan.inLine };
  return diff > 0 ? { state: "over", text: t.plan.above(formatKcal(diff)) } : { state: "under", text: t.plan.below(formatKcal(-diff)) };
}

/** Day totals against the goals, each with a bar and a text label ("in linea", "▲ 250 sopra"). */
export function PlanDaySummary({ day, goals, children }: { day: PlannedDay; goals: PlanGoals | null; children?: ReactNode }) {
  const sum = dayNutrients(day);
  if (!sum.known) return children ? <section className="card plan-summary">{children}</section> : null;
  const rows: Array<{ label: string; value: number; goal: number | null; unit: string; tolerance: number }> = [
    { label: t.calories.label, value: sum.kcal, goal: goals?.kcal ?? null, unit: "kcal", tolerance: goals?.kcal ? goals.kcal * KCAL_TOLERANCE : 0 },
    { label: t.macros.protein, value: sum.protein, goal: goals?.protein ?? null, unit: "g", tolerance: GRAMS_TOLERANCE },
    { label: t.macros.carbs, value: sum.carbs, goal: goals?.carbs ?? null, unit: "g", tolerance: GRAMS_TOLERANCE * 2 },
    { label: t.macros.fat, value: sum.fat, goal: goals?.fat ?? null, unit: "g", tolerance: GRAMS_TOLERANCE },
    { label: t.macros.fiber, value: sum.fiber, goal: goals?.fiber ?? null, unit: "g", tolerance: 5 },
  ];
  return (
    <section className="card plan-summary" aria-label={t.plan.dayTotal}>
      <span className="plan-summary-title">{t.plan.dayTotal}</span>
      {rows.map((row) => {
        const value = formatKcal(Math.round(row.value));
        const state = row.goal ? stateOf(row.value, row.goal, row.tolerance) : null;
        return (
          <div key={row.label} className="plan-summary-row" data-state={sum.hasFree ? undefined : state?.state}>
            <div className="plan-summary-line">
              <strong>{row.label}</strong>
              <span className="plan-summary-value">{row.goal ? t.plan.ofGoal(value, formatKcal(row.goal), row.unit) : t.plan.noGoalValue(value, row.unit)}</span>
            </div>
            {row.goal ? (
              <div className="plan-summary-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (row.value / row.goal) * 100)}%` }} />
              </div>
            ) : null}
            {state && !sum.hasFree && <span className="plan-summary-state">{state.text}</span>}
          </div>
        );
      })}
      {sum.hasFree && <p className="muted plan-summary-note">{t.plan.withoutFree}</p>}
      {children}
    </section>
  );
}

/** "Stesso orario tutti i giorni": a change of time applies to the same meal on every day. */
export function SameTimeSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="plan-same-time">
      <span>{t.plan.sameTime}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * "Sposta": the dish of a meal goes to the same meal of another day and that day's dish takes its place. The days are
 * listed with the dish they would send back, so the swap is clear before it is made.
 */
export function MoveMeal({ plan, day, index, onMove, busy, failed }: { plan: MealPlan; day: Weekday; index: number; onMove: (toDay: Weekday) => void; busy?: boolean; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  const meal = plan.days[day].meals[index];
  if (!meal) return null;
  if (!open) {
    return (
      <button type="button" className="plan-meal-action" disabled={busy} aria-label={t.plan.moveOf(meal.title)} onClick={() => setOpen(true)}>
        <MoveIcon />
        {t.plan.move}
      </button>
    );
  }
  return (
    <div className="plan-move" role="group" aria-label={t.plan.moveTitle}>
      <strong>{t.plan.moveTitle}</strong>
      <div className="plan-move-list">
        {WEEKDAYS.filter((w) => w !== day && plan.days[w].meals[index]).map((w) => {
          const other = plan.days[w].meals[index]!;
          const dish = isFixedMeal(other) ? (other.description ?? other.foods.map(foodLine).join(", ")) : t.plan.freeBadge.toLowerCase();
          return (
            <button
              key={w}
              type="button"
              className="plan-move-row"
              disabled={busy}
              onClick={() => {
                onMove(w);
                setOpen(false);
              }}
            >
              {t.plan.moveRow(t.weekdaysLong[WEEKDAYS.indexOf(w)]!, dish)}
            </button>
          );
        })}
      </div>
      <span className="muted">{t.plan.moveHint}</span>
      {failed && <p className="error-text">{t.plan.moveFailed}</p>}
      <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
        {t.plan.moveClose}
      </button>
    </div>
  );
}

function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />
    </svg>
  );
}

/** A food row of the editor; a food that came with its values remembers them, to keep or scale them on save. */
interface FoodRow {
  name: string;
  quantity: string;
  unit: string;
  nutrients?: PlannedFood["nutrients"];
  origName?: string;
  origQuantity?: number;
  origUnit?: string;
}

/**
 * The values of a saved food when its row is saved: kept as they are when nothing changed, scaled in proportion when
 * only the amount changed, dropped when the name or the unit changed (they would no longer describe the food).
 */
function foodNutrients(row: FoodRow, quantity: number | undefined): PlannedFood["nutrients"] {
  const n = row.nutrients;
  if (!n || row.origQuantity === undefined || quantity === undefined) return undefined;
  if (row.name.trim() !== row.origName || row.unit.trim() !== (row.origUnit ?? "")) return undefined;
  if (quantity === row.origQuantity) return n;
  const k = quantity / row.origQuantity;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { kcal: r1(n.kcal * k), protein: r1(n.protein * k), carbs: r1(n.carbs * k), fat: r1(n.fat * k), fiber: r1(n.fiber * k), ...(n.sugar !== undefined && n.addedSugar !== undefined ? { sugar: r1(n.sugar * k), addedSugar: r1(Math.min(n.addedSugar, n.sugar) * k) } : {}) };
}

export interface DishEdit {
  description: string;
  foods: PlannedFood[];
  macros?: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
}

const MACRO_FIELDS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const text = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","));
const number = (value: string) => Number(value.trim().replace(",", "."));

/**
 * "Modifica": the dish of one meal edited by hand: its text, its foods (name, amount, unit) and the main nutrients.
 * The nutrients are not recalculated from the foods; leaving them all empty keeps what the meal had.
 */
export function EditMeal({ meal, onSave, busy, failed, onSplit }: { meal: PlannedMeal; onSave: (edit: DishEdit, done: () => void) => void; busy?: boolean; failed?: boolean; onSplit?: () => void }) {
  const fixed = isFixedMeal(meal) ? meal : null;
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [foods, setFoods] = useState<Array<FoodRow>>([]);
  const [macros, setMacros] = useState<Record<(typeof MACRO_FIELDS)[number], string>>({ kcal: "", protein: "", carbs: "", fat: "", fiber: "" });
  const [problem, setProblem] = useState<string | null>(null);
  // "Ricalcola con l'IA" (paid, needs the AI part and the key) and "Cerca nel database" (free)
  const aiAvailable = useFeatures().data?.recognition === true;
  const estimate = useEstimateMacros();
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function start() {
    setDescription(fixed?.description ?? "");
    setFoods(fixed ? fixed.foods.map((f) => ({ name: f.name, quantity: text(f.quantity), unit: f.unit ?? "", nutrients: f.nutrients, origName: f.name, origQuantity: f.quantity, origUnit: f.unit })) : [{ name: "", quantity: "", unit: "g" }]);
    const m = fixed?.macros;
    setMacros({ kcal: text(m?.kcal), protein: text(m?.protein), carbs: text(m?.carbs), fat: text(m?.fat), fiber: text(m?.fiber) });
    setProblem(null);
    setPicking(false);
    setNote(null);
    estimate.reset();
    setOpen(true);
  }

  if (!open) {
    return (
      <button type="button" className="plan-meal-action" disabled={busy} aria-label={t.plan.editOf(meal.title)} onClick={start}>
        <EditIcon />
        {t.plan.edit}
      </button>
    );
  }

  const setFood = (index: number, patch: Partial<FoodRow>) => setFoods(foods.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  const filledFoods = () => {
    const parsed: PlannedFood[] = [];
    for (const f of foods.filter((row) => row.name.trim())) {
      const quantity = f.quantity.trim() === "" ? undefined : number(f.quantity);
      if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) return null;
      parsed.push({ name: f.name.trim(), ...(quantity !== undefined ? { quantity } : {}), ...(f.unit.trim() && quantity !== undefined ? { unit: f.unit.trim() } : {}) });
    }
    return parsed.length > 0 ? parsed : null;
  };

  function askAi() {
    const parsed = filledFoods();
    if (!parsed) return setProblem(t.plan.editNeedFood);
    setProblem(null);
    estimate.mutate(
      { description: description.trim(), foods: parsed },
      {
        onSuccess: ({ macros: m }) => {
          setMacros({ kcal: text(m.kcal), protein: text(m.protein), carbs: text(m.carbs), fat: text(m.fat), fiber: text(m.fiber) });
          setNote(t.plan.aiEstimated);
        },
      },
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const named = foods.filter((f) => f.name.trim());
    if (named.length === 0) return setProblem(t.plan.editNeedFood);
    const parsed: PlannedFood[] = [];
    for (const f of named) {
      const quantity = f.quantity.trim() === "" ? undefined : number(f.quantity);
      if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) return setProblem(t.plan.editNeedNumber);
      const nutrients = foodNutrients(f, quantity);
      parsed.push({ name: f.name.trim(), ...(quantity !== undefined ? { quantity } : {}), ...(f.unit.trim() && quantity !== undefined ? { unit: f.unit.trim() } : {}), ...(nutrients ? { nutrients } : {}) });
    }
    const filled = MACRO_FIELDS.filter((key) => macros[key].trim() !== "");
    let edit: DishEdit = { description: description.trim(), foods: parsed };
    if (filled.length > 0) {
      const values = Object.fromEntries(MACRO_FIELDS.map((key) => [key, macros[key].trim() === "" ? 0 : number(macros[key])])) as Record<(typeof MACRO_FIELDS)[number], number>;
      if (Object.values(values).some((v) => !Number.isFinite(v) || v < 0)) return setProblem(t.plan.editNeedNumber);
      edit = { ...edit, macros: values };
    }
    setProblem(null);
    onSave(edit, () => setOpen(false));
  }

  const macroLabels: Record<(typeof MACRO_FIELDS)[number], string> = { kcal: `${t.calories.label} (kcal)`, protein: `${t.macros.protein} (g)`, carbs: `${t.macros.carbs} (g)`, fat: `${t.macros.fat} (g)`, fiber: `${t.macros.fiber} (g)` };

  return (
    <form className="plan-edit" onSubmit={submit} aria-label={t.plan.editOf(meal.title)}>
      <label className="field">
        <span>{t.plan.editDish}</span>
        <input value={description} maxLength={200} placeholder={t.plan.editDishPlaceholder} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <span className="plan-edit-title">{t.plan.editFoods}</span>
      {foods.map((food, i) => (
        <div key={i} className="plan-edit-food">
          <input value={food.name} maxLength={80} aria-label={`${t.plan.foodName} ${i + 1}`} placeholder={t.plan.foodName} onChange={(e) => setFood(i, { name: e.target.value })} />
          <input value={food.quantity} inputMode="decimal" aria-label={`${t.plan.foodQty} · ${food.name || i + 1}`} placeholder="0" onChange={(e) => setFood(i, { quantity: e.target.value })} />
          <input value={food.unit} maxLength={12} aria-label={`${t.plan.foodUnit} · ${food.name || i + 1}`} placeholder="g" onChange={(e) => setFood(i, { unit: e.target.value })} />
          <button type="button" className="item-remove" aria-label={t.plan.foodRemove(food.name)} disabled={foods.length <= 1} onClick={() => setFoods(foods.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {foods.length < 20 && (
        <button type="button" className="text-button text-button-strong add-food" onClick={() => setFoods([...foods, { name: "", quantity: "", unit: "g" }])}>
          {t.plan.addFood}
        </button>
      )}

      <span className="plan-edit-title">{t.plan.editValues}</span>
      <div className="plan-edit-values">
        {MACRO_FIELDS.map((key) => (
          <label key={key} className="field">
            <span>{macroLabels[key]}</span>
            <input value={macros[key]} inputMode="decimal" onChange={(e) => setMacros({ ...macros, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      <span className="muted plan-edit-hint">{t.plan.editValuesHint}</span>
      <div className="plan-edit-tools">
        <button type="button" className="button-secondary-small" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <SearchIcon />
          {t.plan.dbSearch}
        </button>
        {aiAvailable && onSplit && fixed && fixed.foods.some((f) => !f.nutrients) && (
          <button type="button" className="button-secondary-small button-ai-soft" disabled={busy} title={t.plan.splitHint} onClick={onSplit}>
            <SparklesIcon size={14} />
            {t.plan.split}
          </button>
        )}
        {aiAvailable && (
          <button type="button" className="button-secondary-small button-ai-soft" disabled={estimate.isPending} title={t.plan.aiEstimateHint} onClick={askAi}>
            <SparklesIcon size={14} />
            {estimate.isPending ? t.plan.aiEstimating : t.plan.aiEstimate}
          </button>
        )}
      </div>
      {estimate.isError && (
        <p className="error-text" role="alert">
          {planErrorText(estimate.error)}
        </p>
      )}
      {note && (
        <p className="muted plan-edit-hint" role="status">
          {note}
        </p>
      )}
      {picking && (
        <FoodPicker
          foods={foods}
          onApply={(values, used, total) => {
            setMacros({ kcal: text(Math.round(values.kcal)), protein: text(Math.round(values.protein * 10) / 10), carbs: text(Math.round(values.carbs * 10) / 10), fat: text(Math.round(values.fat * 10) / 10), fiber: text(Math.round(values.fiber * 10) / 10) });
            setNote(t.plan.dbApplied(used, total));
            setPicking(false);
          }}
        />
      )}

      {(problem || failed) && (
        <p className="error-text" role="alert">
          {problem ?? t.plan.editFailed}
        </p>
      )}
      <div className="plan-replace-actions">
        <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
          {t.plan.editCancel}
        </button>
        <button type="submit" className="button-primary-inline" disabled={busy}>
          {t.plan.editSave}
        </button>
      </div>
    </form>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

/**
 * "Alternativa": another dish for a meal of the stored plan, in its slot and within the constraints (Claude API, paid,
 * marked with the sparkles). It is shown next to the current dish and only replaces it when "Usa questo" is tapped.
 */
export function AlternativeMeal({ planId, day, index, meal, onUse, busy }: { planId: number; day: Weekday; index: number; meal: PlannedMeal; onUse: (dish: PlannedMeal) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [wish, setWish] = useState("");
  const generate = useAlternativeMeal();
  const current = isFixedMeal(meal) ? meal.macros : undefined;

  if (!open) {
    return (
      <button type="button" className="plan-meal-action" disabled={busy} aria-label={t.plan.alternativeOf(meal.title)} onClick={() => { setOpen(true); setWish(""); generate.reset(); }}>
        <SparklesIcon size={14} />
        {t.plan.alternative}
      </button>
    );
  }
  const run = () => generate.mutate({ id: planId, day, index, note: wish.trim() });
  const candidate = generate.data?.meal;
  const fixed = candidate && isFixedMeal(candidate) ? candidate : null;
  const macros = fixed?.macros;
  return (
    <div className="plan-alt" role="group" aria-label={t.plan.alternativeOf(meal.title)}>
      {!generate.isPending && !fixed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label className="field">
            <span>{t.plan.altWish}</span>
            <input value={wish} maxLength={200} placeholder={t.plan.altWishPlaceholder} autoFocus onChange={(e) => setWish(e.target.value)} />
          </label>
          <span className="muted plan-edit-hint">{t.plan.altNote}</span>
          {generate.isError && (
            <p className="error-text" role="alert">
              {planErrorText(generate.error)}
            </p>
          )}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
              {t.plan.altCancel}
            </button>
            <button type="submit" className="button-primary-inline button-ai">
              <SparklesIcon size={16} />
              {t.plan.altGenerate}
            </button>
          </div>
        </form>
      )}
      {generate.isPending && (
        <p className="plan-meal-busy" aria-live="polite">
          <span className="recognize-spinner" aria-hidden="true" /> {t.plan.altWorking}
        </p>
      )}
      {fixed && (
        <div className="plan-alt-card">
          <span className="plan-edit-title">{t.plan.altProposal}</span>
          <strong>{fixed.description ?? fixed.foods.map(foodLine).join(", ")}</strong>
          <ul>
            {fixed.foods.map((food, i) => (
              <li key={i}>{foodLine(food)}</li>
            ))}
          </ul>
          {macros && <p className="plan-meal-macros">{`${formatKcal(macros.kcal)} kcal · ${t.plan.macroLine(formatKcal(macros.protein), formatKcal(macros.carbs), formatKcal(macros.fat), formatKcal(macros.fiber ?? 0))}`}</p>}
          {current && <p className="muted plan-edit-hint">{t.plan.altNow(formatKcal(current.kcal), formatKcal(current.protein))}</p>}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
              {t.plan.altCancel}
            </button>
            <button type="button" className="button-secondary-small" disabled={generate.isPending} onClick={run}>
              <SparklesIcon size={14} />
              {t.plan.altAnother}
            </button>
            <button type="button" className="button-primary-inline" disabled={busy} onClick={() => { onUse(candidate!); setOpen(false); }}>
              {t.plan.altUse}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Dividi in alimenti con l'IA": the proposed nutrients of each food of a saved meal, shown before anything is saved.
 * Only "Conferma" writes them; the meal keeps its totals. docs/plan-generation.md
 */
export function SplitFoods({
  plan,
  day,
  index,
  onDone,
  onClose,
}: {
  plan: StoredPlan;
  day: Weekday;
  index: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const propose = useSplitFoodsProposal();
  const confirm = useConfirmSplitFoods();
  const [proposal, setProposal] = useState<PlannedFood[] | null>(null);
  const s = t.plan;
  const start = () => propose.mutate({ id: plan.id, day, index }, { onSuccess: (r) => setProposal(r.foods) });
  return (
    <div className="plan-split" role="group" aria-label={s.split}>
      {!proposal && (
        <>
          <span className="muted plan-edit-hint">{s.splitNote}</span>
          {propose.isError && (
            <p className="error-text" role="alert">
              {planErrorText(propose.error)}
            </p>
          )}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={onClose}>
              {s.editCancel}
            </button>
            <button type="button" className="button-primary-inline button-ai" disabled={propose.isPending} onClick={start}>
              <SparklesIcon size={16} />
              {propose.isPending ? s.splitWorking : s.splitAsk}
            </button>
          </div>
        </>
      )}
      {proposal && (
        <>
          <span className="plan-edit-title">{s.splitProposal}</span>
          <ul className="plan-split-list">
            {proposal.map((f, i) => (
              <li key={i}>
                <span>{foodLine(f)}</span>
                {f.nutrients && <span className="muted">{`${formatKcal(Math.round(f.nutrients.kcal))} kcal · P ${formatKcal(Math.round(f.nutrients.protein))} g`}</span>}
              </li>
            ))}
          </ul>
          <span className="muted plan-edit-hint">{s.splitCheck}</span>
          {confirm.isError && (
            <p className="error-text" role="alert">
              {s.splitFailed}
            </p>
          )}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={onClose}>
              {s.editCancel}
            </button>
            <button
              type="button"
              className="button-primary-inline"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate({ id: plan.id, day, index, foods: proposal }, { onSuccess: onDone })}
            >
              {s.splitConfirm}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Dividi la settimana in alimenti": the proposal for every meal of the week that lacks food values, shown day by day
 * before anything is saved; "Conferma la settimana" writes it all in one version. docs/plan-generation.md
 */
export function SplitWeek({ plan, onDone, onClose }: { plan: StoredPlan; onDone: () => void; onClose: () => void }) {
  const propose = useSplitWeekProposal();
  const confirm = useConfirmSplitWeek();
  const [proposal, setProposal] = useState<Array<{ day: string; meals: Array<{ index: number; foods: PlannedFood[] }> }> | null>(null);
  const s = t.plan;
  const nothing = propose.isError && propose.error instanceof ApiError && propose.error.code === "already_split";
  const dayName = (d: string) => t.weekdaysLong[WEEKDAYS.indexOf(d as Weekday)] ?? d;
  return (
    <section className="card plan-split-week" aria-label={s.splitWeekMenu}>
      <strong>{s.splitWeekMenu}</strong>
      {!proposal && (
        <>
          <span className="muted plan-edit-hint">{s.splitWeekNote}</span>
          {nothing && <p className="muted">{s.splitWeekNothing}</p>}
          {propose.isError && !nothing && (
            <p className="error-text" role="alert">
              {planErrorText(propose.error)}
            </p>
          )}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={onClose}>
              {s.editCancel}
            </button>
            <button
              type="button"
              className="button-primary-inline button-ai"
              disabled={propose.isPending}
              onClick={() => propose.mutate(plan.id, { onSuccess: (r) => setProposal(r.days) })}
            >
              <SparklesIcon size={16} />
              {propose.isPending ? s.splitWeekWorking : s.splitWeekAsk}
            </button>
          </div>
        </>
      )}
      {proposal && (
        <>
          <span className="plan-edit-title">{s.splitWeekProposal}</span>
          {proposal.map((d) => (
            <div key={d.day} className="plan-split-day">
              <span className="plan-edit-title">{dayName(d.day)}</span>
              {d.meals.map((m) => {
                const planned = plan.plan.days[d.day as Weekday].meals[m.index];
                return (
                  <div key={m.index} className="plan-split-meal">
                    <span className="muted">{planned?.title ?? ""}</span>
                    <ul className="plan-split-list">
                      {m.foods.map((f, i) => (
                        <li key={i}>
                          <span>{foodLine(f)}</span>
                          {f.nutrients && <span className="muted">{`${formatKcal(Math.round(f.nutrients.kcal))} kcal`}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
          <span className="muted plan-edit-hint">{s.splitCheck}</span>
          {confirm.isError && (
            <p className="error-text" role="alert">
              {s.splitFailed}
            </p>
          )}
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={onClose}>
              {s.editCancel}
            </button>
            <button type="button" className="button-primary-inline" disabled={confirm.isPending} onClick={() => confirm.mutate({ id: plan.id, days: proposal }, { onSuccess: onDone })}>
              {s.splitWeekConfirm}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
