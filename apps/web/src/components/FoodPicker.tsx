import type { FoodCandidateDto } from "@intake/shared";
import { useState } from "react";
import { foodMacros, searchFoods } from "../api/queries";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

export interface PickerFood {
  name: string;
  quantity: string;
  unit: string;
}

export interface PickedValues {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

interface Pick {
  label: string;
  kcal: number;
  values: PickedValues;
}

const grams = (food: PickerFood) => (["g", "ml"].includes(food.unit.trim().toLowerCase()) ? food.quantity.trim() : "");
const short = (text: string) => (text.length > 44 ? `${text.slice(0, 42)}…` : text);

/**
 * "Cerca nel database": for each food of the meal, a free search of USDA generic foods (through the Nutrition server, in
 * English), the right entry picked by the person, and the values for the grams of the row added up. No Claude request.
 */
export function FoodPicker({ foods, onApply }: { foods: PickerFood[]; onApply: (values: PickedValues, used: number, total: number) => void }) {
  const named = foods.map((food, index) => ({ food, index })).filter(({ food }) => food.name.trim());
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [active, setActive] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodCandidateDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const s = t.plan;

  const amountOf = (index: number, food: PickerFood) => amounts[index] ?? grams(food);

  function open(index: number, food: PickerFood) {
    setActive(index);
    setQuery(food.name.trim());
    setResults(null);
    setProblem(null);
  }

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      setResults((await searchFoods(query.trim())).foods);
    } catch {
      setProblem(s.dbFailed);
    } finally {
      setBusy(false);
    }
  }

  async function pick(index: number, food: PickerFood, candidate: FoodCandidateDto) {
    const amount = Number(amountOf(index, food).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return setProblem(s.dbNeedGrams);
    setBusy(true);
    setProblem(null);
    try {
      const { values } = await foodMacros(candidate.id, amount);
      setPicks({ ...picks, [index]: { label: short(candidate.description), kcal: values.kcal, values: { kcal: values.kcal, protein: values.protein, carbs: values.carbs, fat: values.fat, fiber: values.fiber ?? 0 } } });
      setActive(null);
      setResults(null);
    } catch {
      setProblem(s.dbFailed);
    } finally {
      setBusy(false);
    }
  }

  const chosen = Object.entries(picks).filter(([index]) => named.some((n) => n.index === Number(index)));

  function apply() {
    const total = chosen.reduce((sum, [, p]) => ({ kcal: sum.kcal + p.values.kcal, protein: sum.protein + p.values.protein, carbs: sum.carbs + p.values.carbs, fat: sum.fat + p.values.fat, fiber: sum.fiber + p.values.fiber }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    onApply(total, chosen.length, named.length);
  }

  return (
    <div className="food-picker">
      <p className="muted plan-edit-hint">{s.dbHint}</p>
      {named.map(({ food, index }) => {
        const picked = picks[index];
        return (
          <div key={index} className="food-picker-row">
            <div className="food-picker-head">
              <strong>{food.name.trim()}</strong>
              <input value={amountOf(index, food)} inputMode="decimal" placeholder="100" aria-label={`${s.dbGrams} · ${food.name}`} onChange={(e) => setAmounts({ ...amounts, [index]: e.target.value })} />
              <span className="muted">g</span>
              <button type="button" className="button-secondary-small" disabled={busy} onClick={() => open(index, food)}>
                {picked ? s.dbChange : s.dbFind}
              </button>
            </div>
            {picked && <span className="food-picker-picked">{s.dbPicked(picked.label, formatKcal(Math.round(picked.kcal)))}</span>}
            {active === index && (
              <div className="food-picker-search">
                {/* Not a <form>: the picker sits inside the dish editor's form */}
                <div className="food-picker-form">
                  <input
                    value={query}
                    maxLength={100}
                    aria-label={s.dbQuery}
                    placeholder={s.dbQuery}
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void search();
                      }
                    }}
                  />
                  <button type="button" className="button-secondary-small" disabled={busy || !query.trim()} onClick={() => void search()}>
                    {s.dbFind}
                  </button>
                </div>
                {results && results.length === 0 && <span className="muted">{s.dbNoResults}</span>}
                {results && results.length > 0 && (
                  <div className="plan-move-list">
                    {results.map((candidate) => (
                      <button key={candidate.id} type="button" className="plan-move-row food-picker-result" disabled={busy} onClick={() => pick(index, food, candidate)}>
                        <span>{candidate.description}</span>
                        <span className="muted">{s.dbPer100(formatKcal(candidate.kcal), formatKcal(candidate.protein), formatKcal(candidate.carbs), formatKcal(candidate.fat))}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {problem && (
        <p className="error-text" role="alert">
          {problem}
        </p>
      )}
      <button type="button" className="button-primary-inline" disabled={chosen.length === 0} onClick={apply}>
        {s.dbApply(chosen.length, named.length)}
      </button>
    </div>
  );
}
