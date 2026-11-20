import { MEAL_PHOTOS_MAX, MEAL_TYPES, type MealItemInput, type Nutrients, type NutritionMealType, type RecognizedItem, type RecognizedMeal } from "@intake/shared";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ApiError, newIdempotencyKey } from "../api/client";
import { useCreateMeal, useDay, useRecognizeMeal } from "../api/queries";
import { CloseIcon } from "../components/icons";
import { PhotoCarousel } from "../components/PhotoCarousel";
import { formatGrams, formatKcal } from "../lib/format";
import { photoForRecognition } from "../lib/image";
import { t } from "../lib/strings";

type Mode = "photo" | "text";

interface Draft extends RecognizedItem {
  key: number;
}

/** Step of the − / + buttons: finer for small amounts such as oil or cheese. */
const stepFor = (grams: number) => (grams <= 30 ? 5 : 10);

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function nutrientsOf(item: Draft): Nutrients {
  const f = item.grams / 100;
  const p = item.per100g;
  return {
    kcal: round(p.kcal * f, 1),
    protein: round(p.protein * f),
    carbs: round(p.carbs * f),
    fat: round(p.fat * f),
    saturatedFat: null,
    transFat: null,
    fiber: p.fiber === null ? null : round(p.fiber * f),
    sugar: p.sugar === null ? null : round(p.sugar * f),
    addedSugar: p.sugar === null || p.addedSugar === null ? null : round(Math.min(p.addedSugar, p.sugar) * f),
    alcohol: null,
    caffeineMg: null,
    sodiumMg: null,
  };
}

/**
 * Nutrition refuses an itemized meal that gives fiber, sugar or added sugar on some items and not others:
 * a value missing on any item is left out on all of them (and added sugar goes with sugar).
 */
export function allOrNone(items: MealItemInput[]): MealItemInput[] {
  const missing = (key: "fiber" | "sugar" | "addedSugar") => items.some((item) => item.nutrients[key] === null);
  const dropFiber = missing("fiber");
  const dropSugar = missing("sugar");
  const dropAdded = dropSugar || missing("addedSugar");
  return items.map((item) => ({
    ...item,
    nutrients: {
      ...item.nutrients,
      fiber: dropFiber ? null : item.nutrients.fiber,
      sugar: dropSugar ? null : item.nutrients.sugar,
      addedSugar: dropAdded ? null : item.nutrients.addedSugar,
    },
  }));
}

/** Main meal of the time of day, preselected in the meal type control. */
function typeForTime(time: string): NutritionMealType {
  const hour = Number(time.slice(0, 2));
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 19) return "snack";
  return "dinner";
}

/** Message for a failed recognition (also used by "Aggiungi alimento" in Modifica pasto). */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  return (code && t.newMeal.errors[code]) || t.newMeal.errors.recognition_failed!;
}

/**
 * "Nuovo pasto": a photo of the plate or a free description is recognized by Claude (foods, grams, nutrition per
 * 100 g); the user corrects quantities, type and time, then the meal is logged on Nutrition with its items.
 */
export function NewMealPage({ initialMode }: { initialMode: Mode }) {
  const day = useDay("today");
  const [, navigate] = useLocation();
  const recognize = useRecognizeMeal();
  const recognizeExtra = useRecognizeMeal();
  const [adding, setAdding] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const create = useCreateMeal();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  // Up to MEAL_PHOTOS_MAX photos (e.g. one per course), recognized together and kept with the meal
  const [photos, setPhotos] = useState<Array<{ key: string; preview: string; mediaType: "image/jpeg"; data: string }>>([]);
  const [photoError, setPhotoError] = useState(false);
  const [result, setResult] = useState<RecognizedMeal | null>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [type, setType] = useState<NutritionMealType | null>(null);

  const clock = day.data?.clock;
  const nowTime = clock ? clock.localTime.slice(0, 5) : null;
  const mealTime = time ?? nowTime ?? "12:00";
  const mealType = type ?? typeForTime(mealTime);

  const totals = useMemo(
    () =>
      items.reduce(
        (sum, item) => {
          const n = nutrientsOf(item);
          return { kcal: sum.kcal + n.kcal, protein: sum.protein + n.protein, carbs: sum.carbs + n.carbs, fat: sum.fat + n.fat };
        },
        { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [items],
  );

  function showResult(meal: RecognizedMeal) {
    setResult(meal);
    setItems(meal.items.map((item, key) => ({ ...item, key })));
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(false);
    try {
      const photo = await photoForRecognition(file);
      // Nothing is sent yet: the photos are shown with the note, and "Analizza" sends them all
      setPhotos((list) => (list.length >= MEAL_PHOTOS_MAX ? list : [...list, { key: `p${Date.now()}`, preview: photo.previewUrl, mediaType: photo.mediaType, data: photo.data }]));
      recognize.reset();
    } catch {
      setPhotoError(true);
    }
  }

  function analyzePhoto() {
    if (photos.length > 0) recognize.mutate({ images: photos.map(({ mediaType, data }) => ({ mediaType, data })), text: note.trim() || undefined }, { onSuccess: showResult });
  }

  /** Opens the photo picker again for another photo (on iPhone it also offers the camera). */
  function addPhoto() {
    // Clear the picker, or choosing the same picture again would not fire onChange
    if (library.current) library.current.value = "";
    library.current?.click();
  }

  function removePhoto(key: string) {
    setPhotos((list) => list.filter((photo) => photo.key !== key));
    recognize.reset();
  }

  function analyzeText() {
    setPhotos([]);
    if (text.trim()) recognize.mutate({ text: text.trim() }, { onSuccess: showResult });
  }

  function restart() {
    setResult(null);
    setItems([]);
    setPhotos([]);
    recognize.reset();
  }

  /** "+ Aggiungi alimento": a food the photo missed, described in words and recognized the same way. */
  function addFood() {
    const text = extra.trim();
    if (!text) return;
    recognizeExtra.mutate(
      { text },
      {
        onSuccess: (meal) => {
          setItems((list) => {
            const next = list.reduce((max, item) => Math.max(max, item.key), -1) + 1;
            return [...list, ...meal.items.map((item, i) => ({ ...item, key: next + i }))];
          });
          setExtra("");
          setAdding(false);
        },
      },
    );
  }

  function changeGrams(index: number, direction: 1 | -1) {
    setItems((list) =>
      list.map((item, i) => {
        if (i !== index) return item;
        const step = stepFor(direction < 0 ? item.grams - 1 : item.grams);
        return { ...item, grams: Math.max(5, item.grams + direction * step) };
      }),
    );
  }

  const name = favoriteName ?? result?.description.slice(0, 100) ?? "";

  function log() {
    if (!clock || !result || items.length === 0) return;
    const inputs = allOrNone(items.map((item) => ({ name: item.name, quantity: item.grams, unit: "g", nutrients: nutrientsOf(item) })));
    create.mutate(
      {
        date: clock.localDate,
        time: mealTime,
        type: mealType,
        description: result.description,
        items: inputs,
        idempotencyKey,
        ...(photos.length > 0 ? { photos: photos.map(({ mediaType, data }) => ({ mediaType, data })) } : {}),
        ...(favorite && name.trim() ? { favoriteName: name.trim() } : {}),
      },
      { onSuccess: () => navigate("/") },
    );
  }

  // ── Step 1: photo or description ──────────────────────────
  if (!result) {
    return (
      <div className="page detail-page edit-page new-meal-page">
        <header className="edit-header">
          <Link href="/" className="text-button">
            {t.newMeal.cancel}
          </Link>
          <h1>{t.newMeal.title}</h1>
          <span />
        </header>

        <div className="segmented" role="radiogroup" aria-label={t.newMeal.modeAria}>
          {(["photo", "text"] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={mode === option} className="segmented-option" disabled={recognize.isPending} onClick={() => setMode(option)}>
              {t.newMeal.modes[option]}
            </button>
          ))}
        </div>

        {recognize.isPending ? (
          <div className="card recognize-wait" aria-live="polite" aria-busy="true">
            {photos[0] && <img src={photos[0].preview} alt="" className="recognize-preview" />}
            <span className="recognize-spinner" aria-hidden="true" />
            <strong>{t.newMeal.analyzing}</strong>
          </div>
        ) : mode === "photo" ? (
          <>
            {photos.length > 0 ? (
              <div className="card photo-check">
                <PhotoCarousel photos={photos.map((photo) => ({ key: photo.key, src: photo.preview }))} title={t.newMeal.title} onRemove={removePhoto} onAdd={addPhoto} />
                <p className="sheet-note">{photos.length >= MEAL_PHOTOS_MAX ? t.photos.limit(MEAL_PHOTOS_MAX) : t.photos.tip}</p>
              </div>
            ) : (
              <div className="capture-actions">
                <button type="button" className="capture-button" data-primary onClick={() => camera.current?.click()}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  {t.newMeal.takePhoto}
                </button>
                <button type="button" className="capture-button" onClick={() => library.current?.click()}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="3" />
                    <circle cx="9" cy="10" r="2" />
                    <path d="M21 16l-5-5-9 9" />
                  </svg>
                  {t.newMeal.library}
                </button>
              </div>
            )}
            {/* The camera input opens the camera directly on iPhone; the library one opens the photo picker */}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <input ref={library} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <div className="form-card">
              <input className="note-input" value={note} maxLength={300} placeholder={t.newMeal.notePlaceholder} aria-label={t.newMeal.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="sheet-note">{t.newMeal.photoTip}</p>
            {photos.length > 0 && (
              <button type="button" className="button-primary" onClick={analyzePhoto}>
                {t.newMeal.analyze}
              </button>
            )}
          </>
        ) : (
          <>
            <label className="form-card text-entry">
              <span className="sheet-section">{t.newMeal.textLabel}</span>
              <textarea value={text} rows={5} maxLength={1000} placeholder={t.newMeal.textPlaceholder} onChange={(e) => setText(e.target.value)} />
            </label>
            <button type="button" className="button-primary" disabled={!text.trim()} onClick={analyzeText}>
              {t.newMeal.analyze}
            </button>
          </>
        )}

        {photoError && <p className="notice" data-kind="error">{t.newMeal.unreadablePhoto}</p>}
        {recognize.isError && <p className="notice" data-kind="error">{errorText(recognize.error)}</p>}
      </div>
    );
  }

  // ── Step 2: confirm and correct ───────────────────────────
  const values = [
    ["kcal", formatKcal(totals.kcal)],
    ["protein", formatGrams(totals.protein)],
    ["carbs", formatGrams(totals.carbs)],
    ["fat", formatGrams(totals.fat)],
  ] as const;

  return (
    <div className="page detail-page edit-page new-meal-page">
      <header className="edit-header">
        <button type="button" className="text-button" onClick={restart}>
          {t.newMeal.retake}
        </button>
        <h1>{t.newMeal.title}</h1>
        <span />
      </header>

      <div className="card recognized-card">
        {photos[0] && (
          <span className="meal-thumb-wrap">
            <img src={photos[0].preview} alt="" className="recognized-photo" />
            {photos.length > 1 && (
              <span className="meal-thumb-count" aria-label={t.photos.count(photos.length)}>
                {photos.length}
              </span>
            )}
          </span>
        )}
        <span className="recognized-text">
          <span className="eyebrow">{t.newMeal.recognized}</span>
          <strong className="stat-value">
            {formatKcal(totals.kcal)} <span className="muted">{t.newMeal.estimatedKcal}</span>
          </strong>
          <span className="muted">{result.description}</span>
        </span>
      </div>

      <div className="segmented" role="radiogroup" aria-label={t.newMeal.type}>
        {MEAL_TYPES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={mealType === option} className="segmented-option" onClick={() => setType(option)}>
            {t.mealTypes[option]}
          </button>
        ))}
      </div>

      <div className="form-card">
        <label className="form-row">
          <span>{t.newMeal.time}</span>
          <input type="time" value={mealTime} onChange={(e) => setTime(e.target.value)} aria-label={t.newMeal.time} />
        </label>
      </div>

      <span className="sheet-section">{t.newMeal.foods}</span>
      <div className="form-card">
        {items.map((item, index) => (
          <div key={item.key} className="item-edit">
            <div className="item-edit-row recognized-row">
              <span className="recognized-name">
                <strong>{item.name}</strong>
                {!item.visible && <span className="estimate-pill">{t.newMeal.notVisible}</span>}
                <span className="muted">{formatKcal(nutrientsOf(item).kcal)} kcal</span>
              </span>
              <span className="stepper">
                <button type="button" aria-label={t.newMeal.less(item.name)} disabled={item.grams <= 5} onClick={() => changeGrams(index, -1)}>
                  −
                </button>
                <span className="stat-value" aria-live="polite">
                  {formatKcal(item.grams)} g
                </span>
                <button type="button" aria-label={t.newMeal.more(item.name)} onClick={() => changeGrams(index, 1)}>
                  +
                </button>
              </span>
              <button type="button" className="item-remove" aria-label={t.newMeal.remove(item.name)} onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>
                <CloseIcon size={18} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="muted recognized-empty">{t.newMeal.noFoods}</p>}
        {adding ? (
          <form
            className="add-food-row"
            onSubmit={(event) => {
              event.preventDefault();
              addFood();
            }}
          >
            <input
              className="note-input"
              value={extra}
              maxLength={300}
              autoFocus
              enterKeyHint="done"
              placeholder={t.newMeal.addFoodPlaceholder}
              aria-label={t.newMeal.addFoodPlaceholder}
              disabled={recognizeExtra.isPending}
              onChange={(e) => setExtra(e.target.value)}
            />
            <button type="submit" className="text-button text-button-strong" disabled={recognizeExtra.isPending || !extra.trim()}>
              {recognizeExtra.isPending ? t.newMeal.addFoodPending : t.newMeal.addFoodSubmit}
            </button>
          </form>
        ) : (
          <button type="button" className="text-button text-button-strong add-food" onClick={() => setAdding(true)}>
            {t.newMeal.addFood}
          </button>
        )}
        {recognizeExtra.isError && <p className="error-text">{errorText(recognizeExtra.error)}</p>}
      </div>

      <span className="sheet-section">{t.newMeal.values}</span>
      <div className="value-tiles">
        {values.map(([key, value]) => (
          <div key={key} className="value-tile" data-readonly>
            <span>{t.edit.labels[key]}</span>
            <strong className="stat-value">{value}</strong>
          </div>
        ))}
      </div>
      <p className="sheet-note">{t.newMeal.estimateNote}</p>

      <div className="form-card favorite-card">
        <label className="profile-row-item setup-switch-row">
          <span className="connection-text">
            <strong>{t.newMeal.saveFavorite}</strong>
            <span className="muted">{t.newMeal.saveFavoriteNote}</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
        </label>
        {favorite && (
          <input
            className="note-input favorite-name"
            value={name}
            maxLength={100}
            placeholder={t.newMeal.favoriteName}
            aria-label={t.newMeal.favoriteName}
            onChange={(e) => setFavoriteName(e.target.value)}
          />
        )}
      </div>

      <div className="detail-spacer" />
      {create.isError && <p className="notice" data-kind="error">{t.newMeal.logFailed}</p>}
      <button type="button" className="button-primary" disabled={create.isPending || items.length === 0 || !clock || (favorite && !name.trim())} onClick={log}>
        {t.newMeal.log(formatKcal(totals.kcal))}
      </button>
    </div>
  );
}
