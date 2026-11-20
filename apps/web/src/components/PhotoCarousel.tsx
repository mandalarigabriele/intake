import { MEAL_PHOTOS_MAX } from "@intake/shared";
import { useRef, useState } from "react";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";

export interface CarouselPhoto {
  /** Stable key: the server photo id, or a local key for a photo not saved yet. */
  key: string;
  src: string;
}

interface Props {
  photos: CarouselPhoto[];
  /** Short title of the meal, for the alternative text of each photo. */
  title: string;
  /** Shows a × on each photo (Nuovo pasto, Modifica pasto). */
  onRemove?: (key: string) => void;
  /** Shows a last tile "Aggiungi foto" while fewer than MEAL_PHOTOS_MAX photos are shown. */
  onAdd?: () => void;
  disabled?: boolean;
}

/**
 * Photos of a meal side by side: swipe on touch screens (scroll snap), arrows with a mouse, and "2 / 3" under them.
 * Read-only on the meal detail; with onRemove / onAdd in Nuovo pasto and Modifica pasto.
 */
export function PhotoCarousel({ photos, title, onRemove, onAdd, disabled }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const canAdd = Boolean(onAdd) && photos.length < MEAL_PHOTOS_MAX;
  const slides = photos.length + (canAdd ? 1 : 0);
  const current = Math.min(index, Math.max(0, slides - 1));

  const goTo = (next: number) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(slides - 1, next));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="photo-carousel" role="group" aria-label={t.photos.label}>
      <div
        ref={track}
        className="photo-track"
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {photos.map((photo, i) => (
          <figure key={photo.key} className="photo-slide">
            <img src={photo.src} alt={`${t.meal.photoAlt(title)} · ${t.photos.item(i + 1, photos.length)}`} loading={i === 0 ? "eager" : "lazy"} />
            {onRemove && (
              <button type="button" className="photo-remove" aria-label={t.photos.remove(i + 1)} disabled={disabled} onClick={() => onRemove(photo.key)}>
                <CloseIcon size={18} strokeWidth={2.4} />
              </button>
            )}
          </figure>
        ))}
        {canAdd && (
          <button type="button" className="photo-slide photo-add" disabled={disabled} onClick={onAdd}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <path d="M12 10v6M9 13h6" />
            </svg>
            <span>{t.photos.add}</span>
          </button>
        )}
      </div>
      {slides > 1 && (
        <div className="photo-nav">
          <button type="button" className="photo-arrow" aria-label={t.photos.previous} disabled={current === 0} onClick={() => goTo(current - 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="photo-count muted" aria-live="polite">
            {current < photos.length ? `${current + 1} / ${photos.length}` : t.photos.add}
          </span>
          <button type="button" className="photo-arrow" aria-label={t.photos.next} disabled={current >= slides - 1} onClick={() => goTo(current + 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
