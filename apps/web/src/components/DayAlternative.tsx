import type { PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { useLocation } from "wouter";
import { useDayAlternative, useFeatures } from "../api/queries";
import { formatKcal } from "../lib/format";
import { saveAlternativeDraft } from "../lib/dayAlternativeDraft";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";
import { SparklesIcon } from "./icons";

/**
 * "Alternativa per oggi" (Claude API, paid: marked with the sparkles) on a planned meal of today, in Oggi's next meal
 * and in the Timeline: a hint field ("ho zucchine e uova"), then a proposal sized on what is left of the day, shown with
 * its foods and doses. Only "Registra questo" does something: it opens the meal screen to confirm and log it. The plan is
 * never changed. docs/day-alternative.md
 */
export function DayAlternative({ entry }: { entry: PlannedEntry }) {
  const available = useFeatures().data?.recognition === true;
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const generate = useDayAlternative();
  if (!available || (entry.status !== "todo" && entry.status !== "planned")) return null;
  const s = t.dayAlt;
  const proposal = generate.data;
  const run = () => generate.mutate({ index: entry.index, note: hint.trim() });

  if (!open) {
    return (
      <button type="button" className="button-small button-outline day-alt-open" onClick={() => { setOpen(true); generate.reset(); }}>
        <SparklesIcon size={14} />
        {s.button}
      </button>
    );
  }
  return (
    <div className="day-alt" role="group" aria-label={s.title}>
      {!generate.isPending && !proposal && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label className="field">
            <span>{s.hint}</span>
            <input value={hint} maxLength={300} placeholder={s.hintPlaceholder} autoFocus onChange={(e) => setHint(e.target.value)} />
          </label>
          <span className="muted day-alt-note">{s.note}</span>
          {generate.isError && (
            <p className="error-text" role="alert">
              {planErrorText(generate.error)}
            </p>
          )}
          <div className="day-alt-actions">
            <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
              {s.cancel}
            </button>
            <button type="submit" className="button-primary-inline button-ai">
              <SparklesIcon size={16} />
              {s.generate}
            </button>
          </div>
        </form>
      )}
      {generate.isPending && (
        <p className="plan-meal-busy" aria-live="polite">
          <span className="recognize-spinner" aria-hidden="true" /> {s.working}
        </p>
      )}
      {proposal && (
        <div className="day-alt-card">
          <span className="plan-edit-title">{s.proposal}</span>
          <strong>{proposal.description}</strong>
          <ul>
            {proposal.items.map((item, i) => (
              <li key={i}>{`${item.name} ${String(item.quantity).replace(".", ",")} ${item.unit}`}</li>
            ))}
          </ul>
          <p className="plan-meal-macros">{`${formatKcal(Math.round(proposal.items.reduce((sum, i) => sum + i.nutrients.kcal, 0)))} kcal · P ${formatKcal(Math.round(proposal.items.reduce((sum, i) => sum + i.nutrients.protein, 0)))} g · C ${formatKcal(Math.round(proposal.items.reduce((sum, i) => sum + i.nutrients.carbs, 0)))} g · G ${formatKcal(Math.round(proposal.items.reduce((sum, i) => sum + i.nutrients.fat, 0)))} g`}</p>
          {proposal.budget.kcal !== null && proposal.budget.protein !== null && <p className="muted day-alt-note">{s.budget(formatKcal(proposal.budget.kcal), formatKcal(proposal.budget.protein))}</p>}
          {proposal.reason && (
            <p className="day-alt-reason">
              <strong>{s.reason}:</strong> {proposal.reason}
            </p>
          )}
          <div className="day-alt-actions">
            <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
              {s.cancel}
            </button>
            <button type="button" className="button-secondary-small" disabled={generate.isPending} onClick={run}>
              <SparklesIcon size={14} />
              {s.another}
            </button>
            <button
              type="button"
              className="button-primary-inline"
              onClick={() => {
                saveAlternativeDraft(proposal);
                navigate("/pasto/nuovo/alternativa");
              }}
            >
              {s.use}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
