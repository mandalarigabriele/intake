import { useEffect, useRef, useState } from "react";
import { useAddWater, useDay, useLogPlanned, useRecentMeals, useRepeatMeal } from "../api/queries";
import { formatKcal, formatShortDate } from "../lib/format";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";
import { mealSummary, mealTitle } from "./Timeline";
import { Scrim } from "./Scrim";

/** Icons of the "Altro cibo" rows, from the design. */
const ROW_ICONS = {
  repeat: "M4 12a8 8 0 1 0 3-6.2M4 4v5h5",
  saved: "M12 17l-5 3 1-6-4-4 6-1 2-5 2 5 6 1-4 4 1 6z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  barcode: "M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M20 6v12",
};

function RowIcon({ path }: { path: string }) {
  return (
    <span className="row-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}

interface Props {
  onClose: () => void;
}

const WATER_AMOUNTS = [250, 500];

/**
 * "Aggiungi" sheet opened by the + button: a bottom sheet on phones, a centered dialog on wider screens.
 * Water shortcuts and today's plan meals not yet logged.
 */
export function AddSheet({ onClose }: Props) {
  const addWater = useAddWater("today");
  const today = useDay("today");
  const logPlanned = useLogPlanned("today");
  const [showRecent, setShowRecent] = useState(false);
  const recent = useRecentMeals(showRecent);
  const repeat = useRepeatMeal();
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const planMeals = (today.data?.planned ?? []).filter((entry) => entry.status === "todo" || entry.status === "planned");

  return (
    <Scrim onClose={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t.addSheet.title} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.addSheet.title}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="sheet-water">
          {WATER_AMOUNTS.map((amount, i) => (
            <button
              key={amount}
              ref={i === 0 ? firstButton : undefined}
              type="button"
              className="sheet-water-button"
              disabled={addWater.isPending}
              onClick={() => addWater.mutate(amount, { onSuccess: onClose })}
            >
              {t.water.addLong(`${amount} ml`)}
            </button>
          ))}
        </div>
        {addWater.isError && <p className="error-text">{t.errors.waterFailed}</p>}

        {planMeals.length > 0 && today.data && (
          <>
            <span className="sheet-section">{t.addSheet.fromPlan}</span>
            <div className="sheet-list">
              {planMeals.map((entry) => (
                <button
                  key={`${entry.planId}-${entry.index}`}
                  type="button"
                  className="sheet-row"
                  disabled={!entry.macros || logPlanned.isPending}
                  onClick={() =>
                    logPlanned.mutate({ date: today.data!.date, planId: entry.planId, index: entry.index }, { onSuccess: onClose })
                  }
                >
                  <span className="sheet-row-text">
                    <strong>
                      {entry.title} · {entry.time}
                    </strong>
                    <span className="muted">{entry.foods}</span>
                  </span>
                  <span className="sheet-row-action">{entry.macros ? t.addSheet.log : t.addSheet.noMacros}</span>
                </button>
              ))}
            </div>
            {logPlanned.isError && <p className="error-text">{t.timeline.logFailed}</p>}
          </>
        )}

        <span className="sheet-section">{t.addSheet.otherFood}</span>
        <div className="sheet-list">
          <button type="button" className="sheet-row" aria-expanded={showRecent} onClick={() => setShowRecent((v) => !v)}>
            <RowIcon path={ROW_ICONS.repeat} />
            <span className="sheet-row-text">
              <strong>{t.addSheet.repeat}</strong>
              <span className="muted">{t.addSheet.repeatHint}</span>
            </span>
          </button>
          {showRecent && (
            <div className="recent-list">
              {recent.isPending && <p className="muted recent-empty">{t.loading}</p>}
              {recent.data?.length === 0 && <p className="muted recent-empty">{t.addSheet.noRecent}</p>}
              {recent.data?.map((meal) => (
                <button
                  key={meal.id}
                  type="button"
                  className="sheet-row recent-row"
                  disabled={repeat.isPending}
                  onClick={() => repeat.mutate(meal, { onSuccess: onClose })}
                >
                  <span className="sheet-row-text">
                    <strong>
                      {mealTitle(meal)} · {formatShortDate(meal.date)}
                    </strong>
                    <span className="muted">
                      {mealSummary(meal)} · {formatKcal(meal.nutrients.kcal)} kcal
                    </span>
                  </span>
                  <span className="sheet-row-action">{t.addSheet.log}</span>
                </button>
              ))}
              {repeat.isError && <p className="error-text">{t.timeline.logFailed}</p>}
            </div>
          )}
          {(
            [
              ["saved", t.addSheet.saved, t.addSheet.savedHint],
              ["search", t.addSheet.search, t.addSheet.searchHint],
              ["barcode", t.addSheet.barcode, t.addSheet.barcodeHint],
            ] as const
          ).map(([key, title, hint]) => (
            <button key={key} type="button" className="sheet-row" disabled>
              <RowIcon path={ROW_ICONS[key]} />
              <span className="sheet-row-text">
                <strong>{title}</strong>
                <span className="muted">{hint}</span>
              </span>
              <span className="sheet-row-action">{t.addSheet.soon}</span>
            </button>
          ))}
        </div>
        <p className="sheet-note">{t.addSheet.claudeHint}</p>
      </div>
    </Scrim>
  );
}
