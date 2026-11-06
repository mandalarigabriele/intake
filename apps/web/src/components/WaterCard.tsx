import { formatLiters, formatWater } from "../lib/format";
import { t } from "../lib/strings";
import { WaterIcon } from "./icons";

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
  // "0,75 / 2,5 L" as in the design (unit once, after the goal)
  const total = goalMl ? formatLiters(totalMl) : formatWater(totalMl);

  return (
    <section className="card water-card" aria-label={t.water.title}>
      <span className="water-icon">
        <WaterIcon size={28} />
      </span>
      <div className="water-body">
        <p className="water-title">
          {t.water.title}{" "}
          <span className="muted">
            {total}
            {goalMl ? ` / ${formatWater(goalMl)}` : ""}
          </span>
        </p>
        {segments > 0 && (
          <div className="glasses" role="img" aria-label={t.water.glasses(filled, segments)} style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }}>
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
