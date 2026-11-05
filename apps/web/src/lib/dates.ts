/** Calendar helpers on plain YYYY-MM-DD strings (no timezone conversions). */

function toDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function toString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toString(d);
}

/** Monday to Sunday of the week containing `date`. */
export function weekOf(date: string): string[] {
  const d = toDate(date);
  const offsetFromMonday = (d.getUTCDay() + 6) % 7;
  const monday = addDays(date, -offsetFromMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function dayOfMonth(date: string): number {
  return toDate(date).getUTCDate();
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null): value is string {
  return value !== null && isoDate.test(value) && toString(toDate(value)) === value;
}
