import { SHOPPING_CATEGORIES, WEEKDAYS, foodLine, isFixedMeal, planAverages, shoppingLine, shoppingList } from "@intake/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useShownPlan } from "../api/queries";
import { formatKcal, formatMediumDate } from "../lib/format";
import { makePlanPdf, planPdfName } from "../lib/planPdf";
import { shareFile } from "../lib/shareFile";
import { t } from "../lib/strings";

/**
 * Piano › Stampa o salva PDF: the whole week and the shopping list on a page made for paper. "Stampa / Salva PDF" opens
 * the system print window, where "Salva come PDF" makes the file; the app, the bars and the buttons are hidden by the
 * print styles (styles/base.css). docs/shopping-list.md
 */
export function PlanPrintPage() {
  const { plans, shown } = useShownPlan();
  const items = useMemo(() => (shown ? shoppingList(shown.plan) : []), [shown]);
  const s = t.shopping;
  const averages = shown ? planAverages(shown.plan) : null;

  // The PDF is made when the page opens, so the button only has to share it: iOS drops the share if it comes too long after the tap
  const [pdf, setPdf] = useState<{ blob: Blob; name: string } | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    makePlanPdf(shown.plan)
      .then((blob) => !cancelled && setPdf({ blob, name: planPdfName(shown.plan) }))
      .catch(() => !cancelled && setPdfFailed(true));
    return () => {
      cancelled = true;
    };
  }, [shown]);
  // The installed iPhone app has no print window: only the PDF is offered there
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

  const savePdf = () => (pdf ? shareFile(pdf.blob, pdf.name, "application/pdf") : undefined);

  return (
    <div className="page print-page">
      <div className="print-controls">
        <Link href="/piano?vista=pasti" className="icon-button" aria-label={s.back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <div className="print-controls-text">
          <strong>{s.print}</strong>
          <span className="muted">{s.printHint2}</span>
        </div>
        <div className="print-buttons">
          <button type="button" className="button-primary-inline" disabled={!pdf} onClick={savePdf}>
            {pdf || pdfFailed ? s.savePdf : s.pdfPreparing}
          </button>
          {!standalone && (
            <button type="button" className="button-secondary-small" disabled={!shown} onClick={() => window.print()}>
              {s.printPlain}
            </button>
          )}
        </div>
      </div>

      {plans.isPending && <div className="card skeleton" style={{ height: 240 }} />}
      {plans.data && !shown && <p className="muted">{s.empty}</p>}
      {pdfFailed && <p className="notice" data-kind="error">{s.pdfFailed}</p>}

      {shown && (
        <article className="print-sheet">
          <header className="print-head">
            <h1>{s.printTitle}</h1>
            <p>
              {[s.validFrom(formatMediumDate(shown.validFrom)), averages ? s.goalsLine(averages.kcal !== null ? formatKcal(Math.round(averages.kcal / 50) * 50) : null, averages.protein !== null ? formatKcal(Math.round(averages.protein / 5) * 5) : null) : ""].filter(Boolean).join(" · ")}
            </p>
          </header>

          <div className="print-days">
            {WEEKDAYS.map((weekday, i) => (
              <section key={weekday} className="print-day">
                <h2>{t.weekdaysLong[i]}</h2>
                {shown.plan.days[weekday].meals.map((meal, j) =>
                  isFixedMeal(meal) ? (
                    <div key={j} className="print-meal">
                      <div className="print-meal-head">
                        <strong>{meal.title}</strong>
                        {meal.time && <span>{meal.time}</span>}
                        {meal.macros && <span className="print-kcal">{formatKcal(meal.macros.kcal)} kcal</span>}
                      </div>
                      <p>{meal.description ?? meal.foods.map(foodLine).join(", ")}</p>
                      {meal.description && <p className="print-foods">{meal.foods.map(foodLine).join(" · ")}</p>}
                    </div>
                  ) : (
                    <div key={j} className="print-meal">
                      <div className="print-meal-head">
                        <strong>{meal.title}</strong>
                        {meal.time && <span>{meal.time}</span>}
                      </div>
                      <p>{s.free}</p>
                    </div>
                  ),
                )}
              </section>
            ))}
          </div>

          <section className="print-shopping">
            <h2>{s.title}</h2>
            <div className="print-shopping-columns">
              {SHOPPING_CATEGORIES.map((category) => {
                const inCategory = items.filter((item) => item.category === category);
                if (inCategory.length === 0) return null;
                return (
                  <div key={category} className="print-category">
                    <h3>{s.categories[category]}</h3>
                    <ul>
                      {inCategory.map((item) => (
                        <li key={`${item.name}|${item.unit ?? ""}`}>
                          <span className="print-box" aria-hidden="true" />
                          {shoppingLine(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {shown.plan.notes && shown.plan.notes.length > 0 && (
            <section className="print-notes">
              <h2>{t.plan.notes}</h2>
              <ul>
                {shown.plan.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </div>
  );
}
