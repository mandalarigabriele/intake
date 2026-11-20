import { addDays, dayOfMonth, weekOf } from "../lib/dates";
import { formatLongDate } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  selected: string;
  today: string;
  onSelect: (date: string) => void;
}

function Chevron({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * Monday to Sunday of the selected week; today is marked, the selected day is filled. The arrows move a week back or
 * forward (the same weekday), never past the current week: the week after it would only hold future days.
 */
export function WeekStrip({ selected, today, onSelect }: Props) {
  const week = weekOf(selected);
  const isCurrentWeek = week.includes(today);
  const next = addDays(selected, 7);
  return (
    <nav className="week-strip" aria-label={t.weekStrip}>
      <button type="button" className="week-arrow" aria-label={t.weekNav.previous} onClick={() => onSelect(addDays(selected, -7))}>
        <Chevron d="M15 6l-6 6 6 6" />
      </button>
      {week.map((date, i) => (
        <button
          key={date}
          type="button"
          className="week-day"
          aria-current={date === selected ? "date" : undefined}
          aria-label={formatLongDate(date)}
          data-today={date === today || undefined}
          onClick={() => onSelect(date)}
        >
          <span className="week-day-letter">{t.weekdaysShort[i]}</span>
          <span className="week-day-number">{dayOfMonth(date)}</span>
        </button>
      ))}
      <button type="button" className="week-arrow" aria-label={t.weekNav.next} disabled={isCurrentWeek} onClick={() => onSelect(next > today ? today : next)}>
        <Chevron d="M9 6l6 6-6 6" />
      </button>
    </nav>
  );
}
