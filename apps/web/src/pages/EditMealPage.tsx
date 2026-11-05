import { MEAL_TYPES, type Meal, type MealItemInput, type MealType, type Nutrients } from "@intake/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useDay, useUpdateMeal } from "../api/queries";
import { ConfirmDeleteSheet } from "../components/ConfirmDeleteSheet";
import { CloseIcon } from "../components/icons";
import { formatGrams, formatKcal } from "../lib/format";
import { t } from "../lib/strings";
import { dayHref } from "./MealPage";

interface ItemDraft {
  key: number;
  name: string;
  /** Text as typed, e.g. "150" (Italian decimal comma allowed). */
  quantity: string;
  unit: string | null;
  /** Nutrients of the original item and its original quantity, used to scale. */
  base: Nutrients | null;
  baseQuantity: number | null;
  /** Values typed for a newly added food. */
  manual: { kcal: string; protein: string; carbs: string; fat: string } | null;
}

const parseNumber = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : null;
};

const decimal = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

const emptyNutrients = (kcal = 0, protein = 0, carbs = 0, fat = 0): Nutrients => ({
  kcal, protein, carbs, fat,
  saturatedFat: null, transFat: null, fiber: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null,
});

/** Scales every measured nutrient by `factor`, keeping "not measured" as null. */
function scale(nutrients: Nutrients, factor: number): Nutrients {
  const result = { ...nutrients };
  for (const key of Object.keys(result) as Array<keyof Nutrients>) {
    const value = result[key];
    if (value !== null) result[key] = Math.round(value * factor * 100) / 100;
  }
  return result;
}

function itemNutrients(item: ItemDraft): Nutrients {
  if (item.manual) {
    return emptyNutrients(parseNumber(item.manual.kcal) ?? 0, parseNumber(item.manual.protein) ?? 0, parseNumber(item.manual.carbs) ?? 0, parseNumber(item.manual.fat) ?? 0);
  }
  const quantity = parseNumber(item.quantity);
  if (!item.base) return emptyNutrients();
  if (quantity === null || !item.baseQuantity) return item.base;
  return scale(item.base, quantity / item.baseQuantity);
}

function draftsFrom(meal: Meal): ItemDraft[] {
  return meal.items.map((item, key) => ({
    key,
    name: item.name,
    quantity: item.quantity !== null ? decimal(item.quantity) : "",
    unit: item.unit,
    base: item.nutrients,
    baseQuantity: item.quantity,
    manual: null,
  }));
}

export function EditMealPage({ date, id }: { date: string; id: string }) {
  const day = useDay(date);
  const meal = day.data?.meals.find((m) => m.id === id);
  const [, navigate] = useLocation();
  const update = useUpdateMeal();

  const [type, setType] = useState<MealType>("snack");
  const [time, setTime] = useState("12:00");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [totals, setTotals] = useState({ kcal: "", protein: "", carbs: "", fat: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    if (!meal || loadedId === meal.id) return;
    setType((MEAL_TYPES as readonly string[]).includes(meal.type) ? (meal.type as MealType) : "snack");
    setTime(meal.time);
    setItems(draftsFrom(meal));
    setTotals({ kcal: decimal(meal.nutrients.kcal), protein: decimal(meal.nutrients.protein), carbs: decimal(meal.nutrients.carbs), fat: decimal(meal.nutrients.fat) });
    setLoadedId(meal.id);
  }, [meal, loadedId]);

  const hasItems = (meal?.items.length ?? 0) > 0 || items.length > 0;
  const computed = useMemo(() => {
    return items.reduce(
      (sum, item) => {
        const n = itemNutrients(item);
        return { kcal: sum.kcal + n.kcal, protein: sum.protein + n.protein, carbs: sum.carbs + n.carbs, fat: sum.fat + n.fat };
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [items]);

  const detailHref = `/pasto/${date}/${id}`;

  if (!meal) {
    return (
      <div className="page detail-page">
        {day.isPending ? <div className="card skeleton" style={{ height: 320 }} /> : <p className="notice">{t.meal.notFound}</p>}
      </div>
    );
  }

  const itemsChanged = JSON.stringify(items.map((i) => [i.name, i.quantity])) !== JSON.stringify(draftsFrom(meal).map((i) => [i.name, i.quantity]));
  const validItems = items.filter((item) => item.name.trim() !== "");

  function save() {
    if (!meal) return;
    const itemInputs: MealItemInput[] = validItems.map((item) => ({
      name: item.name.trim(),
      quantity: parseNumber(item.quantity),
      unit: item.unit,
      nutrients: itemNutrients(item),
    }));
    // A changed ingredient list gets a description that matches it
    const description =
      hasItems && itemsChanged
        ? itemInputs.map((i) => [i.name, i.quantity !== null ? decimal(i.quantity) : null, i.unit].filter(Boolean).join(" ")).join(", ")
        : meal.description;
    update.mutate(
      {
        id: meal.id,
        request: hasItems
          ? { date, time, type, description, items: itemInputs }
          : {
              date, time, type, description,
              totals: { kcal: parseNumber(totals.kcal) ?? 0, protein: parseNumber(totals.protein) ?? 0, carbs: parseNumber(totals.carbs) ?? 0, fat: parseNumber(totals.fat) ?? 0 },
            },
      },
      { onSuccess: () => navigate(detailHref) },
    );
  }

  const values = hasItems
    ? [
        ["kcal", formatKcal(computed.kcal)],
        ["protein", formatGrams(computed.protein)],
        ["carbs", formatGrams(computed.carbs)],
        ["fat", formatGrams(computed.fat)],
      ]
    : null;

  return (
    <div className="page detail-page edit-page">
      <header className="edit-header">
        <Link href={detailHref} className="text-button">
          {t.edit.cancel}
        </Link>
        <h1>{t.edit.title}</h1>
        <button type="button" className="text-button text-button-strong" onClick={save} disabled={update.isPending || (hasItems && validItems.length === 0)}>
          {t.edit.save}
        </button>
      </header>
      {update.isError && <p className="error-text">{t.edit.saveFailed}</p>}

      <div className="segmented" role="radiogroup" aria-label={t.edit.type}>
        {MEAL_TYPES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={type === option} className="segmented-option" onClick={() => setType(option)}>
            {t.mealTypes[option]}
          </button>
        ))}
      </div>

      <div className="form-card">
        <label className="form-row">
          <span>{t.edit.time}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t.edit.time} />
        </label>
      </div>

      {hasItems && (
        <>
          <span className="sheet-section">{t.edit.foods}</span>
          <div className="form-card">
            {items.map((item, index) => (
              <div key={item.key} className="item-edit">
                <div className="item-edit-row">
                  <input
                    className="item-name"
                    value={item.name}
                    aria-label={t.edit.food}
                    placeholder={t.edit.food}
                    onChange={(e) => setItems((list) => list.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)))}
                  />
                  <span className="item-quantity">
                    <input
                      value={item.quantity}
                      inputMode="decimal"
                      aria-label={t.edit.quantity}
                      onChange={(e) => setItems((list) => list.map((it, i) => (i === index ? { ...it, quantity: e.target.value } : it)))}
                    />
                    {item.unit && <span className="muted">{item.unit}</span>}
                  </span>
                  <button type="button" className="item-remove" aria-label={t.edit.remove} onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>
                    <CloseIcon size={18} strokeWidth={2.2} />
                  </button>
                </div>
                {item.manual && (
                  <div className="item-manual" aria-label={t.edit.newFoodValues}>
                    {(["kcal", "protein", "carbs", "fat"] as const).map((key) => (
                      <label key={key}>
                        <span>{t.edit.labels[key]}</span>
                        <input
                          value={item.manual![key]}
                          inputMode="decimal"
                          onChange={(e) =>
                            setItems((list) => list.map((it, i) => (i === index ? { ...it, manual: { ...it.manual!, [key]: e.target.value } } : it)))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-button text-button-strong add-food"
              disabled={items.length >= 30}
              onClick={() =>
                setItems((list) => [
                  ...list,
                  { key: Date.now(), name: "", quantity: "", unit: "g", base: null, baseQuantity: null, manual: { kcal: "", protein: "", carbs: "", fat: "" } },
                ])
              }
            >
              {t.edit.addFood}
            </button>
          </div>
        </>
      )}

      <span className="sheet-section">{t.edit.values}</span>
      <div className="value-tiles">
        {values
          ? values.map(([key, value]) => (
              <div key={key} className="value-tile" data-readonly>
                <span>{t.edit.labels[key!]}</span>
                <strong className="stat-value">{value}</strong>
              </div>
            ))
          : (["kcal", "protein", "carbs", "fat"] as const).map((key) => (
              <label key={key} className="value-tile">
                <span>{t.edit.labels[key]}</span>
                <input value={totals[key]} inputMode="decimal" onChange={(e) => setTotals((v) => ({ ...v, [key]: e.target.value }))} />
              </label>
            ))}
      </div>
      {values && <p className="sheet-note">{t.edit.valuesFromFoods}</p>}

      <div className="detail-spacer" />
      <button type="button" className="button-danger" onClick={() => setConfirmDelete(true)}>
        {t.edit.delete}
      </button>

      {confirmDelete && (
        <ConfirmDeleteSheet
          mealId={meal.id}
          mealType={meal.type}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => navigate(dayHref(date, day.data?.clock.localDate))}
        />
      )}
    </div>
  );
}
