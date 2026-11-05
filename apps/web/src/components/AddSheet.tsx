import { useEffect, useRef } from "react";
import { useAddWater } from "../api/queries";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
}

const WATER_AMOUNTS = [250, 500];

/**
 * "Aggiungi" sheet opened by the + button: a bottom sheet on phones, a centered dialog on wider screens.
 * v1 offers water shortcuts; plan meals and recent meals arrive with the next steps.
 */
export function AddSheet({ onClose }: Props) {
  const addWater = useAddWater("today");
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

  return (
    <div className="scrim" onClick={onClose}>
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

        <p className="sheet-note">{t.addSheet.comingSoon}</p>
        <p className="sheet-note">{t.addSheet.claudeHint}</p>
      </div>
    </div>
  );
}
