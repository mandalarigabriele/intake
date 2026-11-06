import { useInsight } from "../api/queries";
import { t } from "../lib/strings";

/** "Dai tuoi dati": one sentence from the owner's own data; hidden when there is not enough data. */
export function InsightCard() {
  const insight = useInsight();
  const data = insight.data?.insight;
  if (!data) return null;
  return (
    <section className="card insight-card" aria-label={t.insight.label}>
      <span className="insight-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.6 1 2.5h6c0-.9.2-1.7 1-2.5A6 6 0 0 0 12 3z" />
        </svg>
      </span>
      <div className="insight-body">
        <span className="insight-label">{t.insight.label.toUpperCase()}</span>
        <p className="insight-text">{data.text}</p>
        <span className="muted">{data.window}</span>
      </div>
    </section>
  );
}
