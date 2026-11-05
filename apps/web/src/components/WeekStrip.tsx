import { dayOfMonth, weekOf } from "../lib/dates";
import { formatLongDate } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  selected: string;
  today: string;
  onSelect: (date: string) => void;
}

/** Monday to Sunday of the selected week; today is marked, the selected day is filled. */
export function WeekStrip({ selected, today, onSelect }: Props) {
  return (
    <nav className="week-strip" aria-label="Giorni della settimana">
      {weekOf(selected).map((date, i) => (
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
    </nav>
  );
}
