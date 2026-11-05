import type { Meal } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useDay, useFavoriteMeal } from "../api/queries";
import { CloseIcon } from "../components/icons";
import { mealTitle } from "../components/Timeline";
import { formatGrams, formatKcal, formatPercent, formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

export function dayHref(date: string, today: string | undefined): string {
  return date === today ? "/" : `/?d=${date}`;
}

function BackHeader({ href, label }: { href: string; label: string }) {
  return (
    <header className="detail-header">
      <Link href={href} className="icon-button" aria-label={t.meal.back}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </Link>
      <span className="detail-context">{label}</span>
    </header>
  );
}

/** Meal detail: kcal, macro split, foods with quantities, other nutrients, edit and save as favorite. */
export function MealPage({ date, id }: { date: string; id: string }) {
  const day = useDay(date);
  const meal = day.data?.meals.find((m) => m.id === id);
  const back = dayHref(date, day.data?.clock.localDate);
  const [favoriteOpen, setFavoriteOpen] = useState(false);

  if (day.isPending) {
    return (
      <div className="page detail-page">
        <BackHeader href={back} label="" />
        <div className="card skeleton" style={{ height: 320 }} />
      </div>
    );
  }
  if (!meal || !day.data) {
    return (
      <div className="page detail-page">
        <BackHeader href={back} label="" />
        <p className="notice">{t.meal.notFound}</p>
      </div>
    );
  }

  const { nutrients: n } = meal;
  const goals = day.data.goals;
  const macroKcal = { protein: n.protein * 4, carbs: n.carbs * 4, fat: n.fat * 9 };
  const totalMacroKcal = macroKcal.protein + macroKcal.carbs + macroKcal.fat;
  const share = (key: keyof typeof macroKcal) => (totalMacroKcal > 0 ? (macroKcal[key] / totalMacroKcal) * 100 : 0);
  const macros = [
    { key: "protein", label: t.macros.protein, grams: n.protein, goal: goals.protein },
    { key: "carbs", label: t.macros.carbs, grams: n.carbs, goal: goals.carbs },
    { key: "fat", label: t.macros.fat, grams: n.fat, goal: goals.fat },
  ] as const;

  const others = [
    n.fiber !== null && { label: t.meal.fiber, value: `${formatGrams(n.fiber)} g` },
    n.sugar !== null && { label: t.meal.sugar, value: `${formatGrams(n.sugar)} g`, sub: n.addedSugar !== null ? t.meal.added(formatGrams(n.addedSugar)) : undefined },
    n.caffeineMg !== null && { label: t.meal.caffeine, value: `${formatKcal(n.caffeineMg)} mg` },
    n.saturatedFat !== null && { label: t.meal.saturatedFat, value: `${formatGrams(n.saturatedFat)} g` },
    n.sodiumMg !== null && { label: t.meal.sodium, value: `${formatKcal(n.sodiumMg)} mg` },
  ].filter(Boolean) as Array<{ label: string; value: string; sub?: string }>;

  return (
    <div className="page detail-page">
      <BackHeader href={back} label={`${formatWeekday(date)} · ${meal.time}`} />

      <section className="detail-hero">
        <h1>{mealTitle(meal)}</h1>
        <span className="detail-kcal">
          {formatKcal(n.kcal)} <span>kcal</span>
        </span>
        {goals.kcal ? <span className="muted">{t.meal.shareOfDay(formatPercent((n.kcal / goals.kcal) * 100), formatKcal(goals.kcal), day.data.isToday)}</span> : null}
      </section>

      <section className="card macro-split" aria-label={t.meal.split}>
        <div className="split-bar" aria-hidden="true">
          {macros.map(({ key }) => (share(key) > 0 ? <span key={key} data-macro={key} style={{ width: `${share(key)}%` }} /> : null))}
        </div>
        <div className="split-values">
          {macros.map(({ key, label, grams, goal }) => (
            <div key={key} data-macro={key}>
              <span className="split-label">{label}</span>
              <strong className="stat-value">{formatGrams(grams)} g</strong>
              {goal ? <span className="muted">{t.meal.ofGoal(formatPercent((grams / goal) * 100))}</span> : null}
            </div>
          ))}
        </div>
      </section>

      {meal.items.length > 0 ? (
        <section className="card detail-list" aria-label={t.meal.foods}>
          {meal.items.map((item, i) => (
            <div key={i} className="detail-row">
              <span>{item.name}</span>
              <span className="muted">{item.quantityText}</span>
            </div>
          ))}
        </section>
      ) : (
        <section className="card detail-list">
          <p className="detail-description">{meal.description}</p>
        </section>
      )}

      {others.length > 0 && (
        <section className="detail-tiles" aria-label={t.meal.otherValues}>
          {others.map((tile) => (
            <div key={tile.label} className="detail-tile">
              <span className="muted">{tile.label}</span>
              <strong className="stat-value">{tile.value}</strong>
              {tile.sub && <span className="detail-tile-sub">{tile.sub}</span>}
            </div>
          ))}
        </section>
      )}

      {meal.notes && (
        <section className="card detail-list">
          <span className="muted">{t.meal.notes}</span>
          <p className="detail-description">{meal.notes}</p>
        </section>
      )}

      <div className="detail-spacer" />
      <div className="detail-actions">
        <Link href={`/pasto/${date}/${id}/modifica`} className="button-secondary">
          {t.meal.edit}
        </Link>
        <button type="button" className="button-primary-inline" onClick={() => setFavoriteOpen(true)}>
          {t.meal.favorite}
        </button>
      </div>

      {favoriteOpen && <FavoriteSheet meal={meal} onClose={() => setFavoriteOpen(false)} />}
    </div>
  );
}

function FavoriteSheet({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  const favorite = useFavoriteMeal();
  const [name, setName] = useState(() => meal.description.replace(/^[^:]{1,20}:\s*/, "").slice(0, 60));

  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.meal.favoriteTitle}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          favorite.mutate({ id: meal.id, name: name.trim() });
        }}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.meal.favoriteTitle}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>
        <label className="field">
          <span>{t.meal.favoriteName}</span>
          <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <p className="sheet-note">{t.meal.favoriteHint}</p>
        {favorite.isSuccess && <p className="notice" data-kind="ok">{t.meal.favoriteSaved}</p>}
        {favorite.isError && <p className="error-text">{t.meal.favoriteFailed}</p>}
        {favorite.isSuccess ? (
          <button type="button" className="button-primary" onClick={onClose}>
            {t.close}
          </button>
        ) : (
          <button type="submit" className="button-primary" disabled={!name.trim() || favorite.isPending}>
            {t.meal.favoriteSave}
          </button>
        )}
      </form>
    </div>
  );
}
