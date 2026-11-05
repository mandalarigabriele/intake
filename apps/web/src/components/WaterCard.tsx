import { formatWater } from "../lib/format";
import { t } from "../lib/strings";

const GLASS_ML = 250;
const MAX_SEGMENTS = 16;

interface Props {
  totalMl: number;
  goalMl: number | null;
  canAdd: boolean;
  adding: boolean;
  failed: boolean;
  onAdd: (amountMl: number) => void;
}

/** Water progress as glasses of 250 ml, with a quick add button. */
export function WaterCard({ totalMl, goalMl, canAdd, adding, failed, onAdd }: Props) {
  const segments = goalMl ? Math.min(Math.max(Math.round(goalMl / GLASS_ML), 1), MAX_SEGMENTS) : 0;
  const filled = Math.min(Math.floor(totalMl / GLASS_ML), segments);

  return (
    <section className="card water-card" aria-label={t.water.title}>
      <svg className="water-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5c-3.2 4.1-5.5 7.3-5.5 10.2a5.5 5.5 0 0 0 11 0c0-2.9-2.3-6.1-5.5-10.2Z" />
      </svg>
      <div className="water-body">
        <p className="water-title">
          <strong>{t.water.title}</strong>{" "}
          <span className="muted">
            {formatWater(totalMl)}
            {goalMl ? ` / ${formatWater(goalMl)}` : ""}
          </span>
        </p>
        {segments > 0 && (
          <div className="glasses" role="img" aria-label={t.water.glasses(filled, segments)}>
            {Array.from({ length: segments }, (_, i) => (
              <span key={i} className="glass" data-filled={i < filled || undefined} />
            ))}
          </div>
        )}
        {failed && <p className="error-text">{t.errors.waterFailed}</p>}
      </div>
      {canAdd && (
        <button type="button" className="water-add" onClick={() => onAdd(GLASS_ML)} disabled={adding}>
          {t.water.add(`${GLASS_ML} ml`)}
        </button>
      )}
    </section>
  );
}
