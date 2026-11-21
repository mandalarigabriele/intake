import { SHOPPING_CATEGORIES, shoppingLine, shoppingList } from "@intake/shared";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useShownPlan } from "../api/queries";
import { t } from "../lib/strings";

/** Lines for the clipboard: one item per line and no headings, so Reminders makes one reminder for each. */
export const shoppingText = (items: ReturnType<typeof shoppingList>) => items.map(shoppingLine).join("\n");

/**
 * Piano › Lista della spesa: the foods of the week added up (plain arithmetic, no AI), by supermarket section, with a
 * button that copies one item per line to paste into Apple Reminders, and the link to the print page. docs/shopping-list.md
 */
export function ShoppingListPage() {
  const { plans, shown } = useShownPlan();
  const items = useMemo(() => (shown ? shoppingList(shown.plan) : []), [shown]);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const s = t.shopping;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shoppingText(items));
      setCopied("ok");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="page detail-page edit-page shopping-page">
      <header className="edit-header edit-header-back">
        <Link href="/piano?vista=pasti" className="icon-button" aria-label={s.back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1>{s.title}</h1>
        <span aria-hidden="true" />
      </header>

      {plans.isPending && <div className="card skeleton" style={{ height: 240 }} />}
      {plans.data && !shown && <p className="muted">{s.empty}</p>}

      {shown && (
        <>
          <p className="sheet-note">{s.intro}</p>
          <div className="shopping-actions">
            <button type="button" className="button-primary-inline" onClick={copy}>
              {copied === "ok" ? s.copied : s.copy}
            </button>
            <Link href="/piano/stampa" className="button-secondary-small shopping-print">
              {s.print}
            </Link>
          </div>
          <p className="muted shopping-hint" role="status">
            {copied === "failed" ? s.copyFailed : s.copyHint}
          </p>

          <span className="sheet-section">{s.count(items.length).toUpperCase()}</span>
          {SHOPPING_CATEGORIES.map((category) => {
            const inCategory = items.filter((item) => item.category === category);
            if (inCategory.length === 0) return null;
            return (
              <section key={category} className="form-card shopping-group" aria-label={s.categories[category]}>
                <h2>{s.categories[category]}</h2>
                <ul>
                  {inCategory.map((item) => (
                    <li key={`${item.name}|${item.unit ?? ""}`}>
                      <span>{shoppingLine(item)}</span>
                      <span className="muted">{s.uses(item.uses)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
