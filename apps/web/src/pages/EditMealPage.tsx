import { MEAL_PHOTOS_MAX, MEAL_TYPES, NUTRITION_MEAL_TYPES, type Meal, type MealItemInput, type Nutrients, type NutritionMealType, type RecognizedItem } from "@intake/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { mealPhotoUrl, useDay, useFeatures, useMealPhotos, useRecognizeMeal, useSaveMealPhotos, useUpdateMeal } from "../api/queries";
import { ConfirmDeleteSheet } from "../components/ConfirmDeleteSheet";
import { CloseIcon } from "../components/icons";
import { PhotoCarousel } from "../components/PhotoCarousel";
import { photoForRecognition } from "../lib/image";
import { formatGrams, formatKcal } from "../lib/format";
import { t } from "../lib/strings";
import { dayHref } from "./MealPage";
import { errorText } from "./NewMealPage";

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

/** A food recognized by Claude, as an item of the meal: its grams and the values for those grams, scaled like the others. */
function draftFromRecognized(item: RecognizedItem, key: number): ItemDraft {
  const p = item.per100g;
  const base = scale({ ...emptyNutrients(p.kcal, p.protein, p.carbs, p.fat), fiber: p.fiber, sugar: p.sugar, addedSugar: p.addedSugar }, item.grams / 100);
  return { key, name: item.name, quantity: decimal(item.grams), unit: "g", base, baseQuantity: item.grams, manual: null };
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

  const [type, setType] = useState<NutritionMealType>("snack");
  const [time, setTime] = useState("12:00");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [totals, setTotals] = useState({ kcal: "", protein: "", carbs: "", fat: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // "+ Aggiungi alimento" with Pasti da foto on: the food is described in words and Claude fills in its values
  const canRecognize = useFeatures().data?.recognition === true;
  const recognizeFood = useRecognizeMeal();
  const [adding, setAdding] = useState(false);
  const [foodText, setFoodText] = useState("");
  // Photos (Pasti da foto): the kept ones, those removed and those added here, all saved with "Salva"
  const keptPhotos = useMealPhotos().data?.get(id) ?? [];
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [addedPhotos, setAddedPhotos] = useState<Array<{ key: string; preview: string; mediaType: "image/jpeg"; data: string }>>([]);
  // A photo just added: its foods can be recognized and added to the meal, or it is kept as a photo only
  const [askPhoto, setAskPhoto] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const [photoError, setPhotoError] = useState(false);
  const recognizePhoto = useRecognizeMeal();
  const savePhotos = useSaveMealPhotos();
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!meal || loadedId === meal.id) return;
    // Keep Nutrition's own type (e.g. afternoon_snack) instead of flattening it to "snack" on save
    setType((NUTRITION_MEAL_TYPES as readonly string[]).includes(meal.type) ? (meal.type as NutritionMealType) : "snack");
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

  /** A new row whose values are typed by hand (without Pasti da foto, or chosen with "Inserisci a mano"). */
  function addManualFood() {
    setItems((list) => [
      ...list,
      { key: Date.now(), name: "", quantity: "", unit: "g", base: null, baseQuantity: null, manual: { kcal: "", protein: "", carbs: "", fat: "" } },
    ]);
    setAdding(false);
    recognizeFood.reset();
  }

  /** The foods Claude found in the description, added as rows with their grams; nothing is saved until "Salva". */
  function addRecognizedFood() {
    const text = foodText.trim();
    if (!text) return;
    recognizeFood.mutate(
      { text },
      {
        onSuccess: (recognized) => {
          setItems((list) => {
            const room = Math.max(0, 30 - list.length);
            return [...list, ...recognized.items.slice(0, room).map((item, i) => draftFromRecognized(item, Date.now() + i))];
          });
          setFoodText("");
          setAdding(false);
        },
      },
    );
  }

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
      {
        onSuccess: () => {
          if (removedPhotos.length === 0 && addedPhotos.length === 0) return navigate(detailHref);
          savePhotos.mutate(
            { mealId: meal.id, remove: removedPhotos, add: addedPhotos.map(({ mediaType, data }) => ({ mediaType, data })) },
            { onSuccess: () => navigate(detailHref) },
          );
        },
      },
    );
  }

  const shownPhotos = [
    ...keptPhotos.filter((photoId) => !removedPhotos.includes(photoId)).map((photoId) => ({ key: photoId, src: mealPhotoUrl(id, photoId) })),
    ...addedPhotos.map((photo) => ({ key: photo.key, src: photo.preview })),
  ];

  async function onPhotoFile(file: File | undefined) {
    if (!file || shownPhotos.length >= MEAL_PHOTOS_MAX) return;
    setPhotoError(false);
    try {
      const photo = await photoForRecognition(file);
      const key = `new-${Date.now()}`;
      setAddedPhotos((list) => [...list, { key, preview: photo.previewUrl, mediaType: photo.mediaType, data: photo.data }]);
      setAskPhoto(key);
      recognizePhoto.reset();
    } catch {
      setPhotoError(true);
    }
  }

  function removePhoto(key: string) {
    if (keptPhotos.includes(key)) setRemovedPhotos((list) => [...list, key]);
    else setAddedPhotos((list) => list.filter((photo) => photo.key !== key));
    if (askPhoto === key) setAskPhoto(null);
  }

  /** The foods of the photo just added (e.g. the second course) become rows of the meal; nothing is saved until "Salva". */
  function recognizeNewPhoto() {
    const photo = addedPhotos.find((p) => p.key === askPhoto);
    if (!photo) return;
    recognizePhoto.mutate(
      { images: [{ mediaType: photo.mediaType, data: photo.data }], text: photoNote.trim() || undefined },
      {
        onSuccess: (recognized) => {
          setItems((list) => {
            const room = Math.max(0, 30 - list.length);
            return [...list, ...recognized.items.slice(0, room).map((item, i) => draftFromRecognized(item, Date.now() + i))];
          });
          setAskPhoto(null);
          setPhotoNote("");
        },
      },
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
      {/* Like the meal detail: the back arrow leaves without saving; Salva sits at the bottom next to Elimina */}
      <header className="edit-header edit-header-back">
        <Link href={detailHref} className="icon-button" aria-label={t.edit.back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1>{t.edit.title}</h1>
        <span aria-hidden="true" />
      </header>

      {canRecognize && (
        <section className="edit-photos" aria-label={t.photos.label}>
          {shownPhotos.length > 0 ? (
            <PhotoCarousel photos={shownPhotos} title={t.edit.title} onRemove={removePhoto} onAdd={() => photoInput.current?.click()} disabled={recognizePhoto.isPending} />
          ) : (
            <button type="button" className="capture-button" onClick={() => photoInput.current?.click()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <path d="M12 10v6M9 13h6" />
              </svg>
              {t.photos.add}
            </button>
          )}
          {/* Without "capture", iPhone offers both the camera and the photo library */}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void onPhotoFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {photoError && <p className="error-text">{t.newMeal.unreadablePhoto}</p>}
          {askPhoto && hasItems && (
            <div className="form-card new-photo-card">
              <strong>{t.photos.newPhoto}</strong>
              <span className="muted">{t.photos.newPhotoNote}</span>
              <input className="note-input" value={photoNote} maxLength={300} placeholder={t.newMeal.notePlaceholder} aria-label={t.newMeal.notePlaceholder} disabled={recognizePhoto.isPending} onChange={(e) => setPhotoNote(e.target.value)} />
              <div className="new-photo-actions">
                <button type="button" className="button-primary-inline" disabled={recognizePhoto.isPending} onClick={recognizeNewPhoto}>
                  {recognizePhoto.isPending ? t.newMeal.analyzing : t.photos.recognize}
                </button>
                <button type="button" className="button-secondary" disabled={recognizePhoto.isPending} onClick={() => setAskPhoto(null)}>
                  {t.photos.photoOnly}
                </button>
              </div>
              {recognizePhoto.isError && <p className="error-text">{errorText(recognizePhoto.error)}</p>}
            </div>
          )}
        </section>
      )}

      <div className="segmented" role="radiogroup" aria-label={t.edit.type}>
        {[...MEAL_TYPES, ...(meal && !(MEAL_TYPES as readonly string[]).includes(meal.type) && (NUTRITION_MEAL_TYPES as readonly string[]).includes(meal.type) ? [meal.type as NutritionMealType] : [])].map((option) => (
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
            {adding ? (
              <form
                className="add-food-row edit-add-food"
                onSubmit={(event) => {
                  event.preventDefault();
                  addRecognizedFood();
                }}
              >
                <label className="muted" htmlFor="edit-add-food-text">
                  {t.edit.addFoodPrompt}
                </label>
                <input
                  id="edit-add-food-text"
                  className="note-input"
                  value={foodText}
                  maxLength={300}
                  autoFocus
                  enterKeyHint="done"
                  placeholder={t.newMeal.addFoodPlaceholder}
                  disabled={recognizeFood.isPending}
                  onChange={(e) => setFoodText(e.target.value)}
                />
                <button type="submit" className="button-primary edit-add-food-claude" disabled={recognizeFood.isPending || !foodText.trim()}>
                  {recognizeFood.isPending ? t.newMeal.addFoodPending : t.edit.addWithClaude}
                </button>
                <button type="button" className="text-button" disabled={recognizeFood.isPending} onClick={addManualFood}>
                  {t.edit.addManually}
                </button>
                {recognizeFood.isError && <p className="error-text">{errorText(recognizeFood.error)}</p>}
              </form>
            ) : (
              <button
                type="button"
                className="text-button text-button-strong add-food"
                disabled={items.length >= 30}
                onClick={() => (canRecognize ? setAdding(true) : addManualFood())}
              >
                {t.edit.addFood}
              </button>
            )}
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
      <div className="edit-actions">
        {update.isError && <p className="error-text">{t.edit.saveFailed}</p>}
        {savePhotos.isError && <p className="error-text">{t.photos.saveFailed}</p>}
        <div className="detail-actions edit-actions-row">
          <button type="button" className="button-secondary edit-delete" onClick={() => setConfirmDelete(true)}>
            {t.edit.delete}
          </button>
          <button type="button" className="button-primary-inline" onClick={save} disabled={update.isPending || savePhotos.isPending || recognizePhoto.isPending || (hasItems && validItems.length === 0)}>
            {t.edit.save}
          </button>
        </div>
      </div>

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
