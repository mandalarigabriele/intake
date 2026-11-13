/** Italian number and date formatting for the UI. */

const LOCALE = "it-IT";

// Italian skips the thousands separator below 10,000 by default ("1762"); always group ("1.762")
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: "always" });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, useGrouping: "always" });

/** 1762 -> "1.762" */
export function formatKcal(value: number): string {
  return integer.format(Math.round(value));
}

/** Grams with at most one decimal: 28.2 -> "28,2", 7 -> "7". */
export function formatGrams(value: number): string {
  return oneDecimal.format(Math.round(value * 10) / 10);
}

/** Rounded grams for compact chips: 28.2 -> "28". */
export function formatGramsShort(value: number): string {
  return integer.format(Math.round(value));
}

const twoDecimals = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

/** Liters with up to two decimals, as in the design: 750 -> "0,75", 2500 -> "2,5". */
export function formatLiters(ml: number): string {
  return twoDecimals.format(Math.round(ml / 10) / 100);
}

/** 2500 -> "2,5 L", 1750 -> "1,75 L". */
export function formatWater(ml: number): string {
  return `${formatLiters(ml)} L`;
}

export function formatPercent(value: number): string {
  return `${integer.format(Math.round(value))}%`;
}

function parseDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

const longDate = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "2026-11-05" -> "Giovedì 5 novembre" */
export function formatLongDate(date: string): string {
  return capitalize(longDate.format(parseDate(date)));
}

const shortDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-11-04" -> "4 nov" */
export function formatShortDate(date: string): string {
  return shortDate.format(parseDate(date));
}

/** "2026-11-04" -> "4 nov 2026" */
export function formatMediumDate(date: string): string {
  return fullDate.format(parseDate(date));
}

/** "2026-11-05" -> "Giovedì" */
export function formatWeekday(date: string): string {
  return capitalize(weekday.format(parseDate(date)));
}

/** "10:02:10" -> "10:02" */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** "2026-10-25" -> "25/10" */
export function formatDayMonth(date: string): string {
  return dayMonth.format(parseDate(date));
}

const dayLongMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", timeZone: "UTC" });

/** "2026-09-08" -> "8 settembre" */
export function formatDayLongMonth(date: string): string {
  return dayLongMonth.format(parseDate(date));
}

const megabytes = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** 1_520_000 bytes -> "1,5 MB" (below 0,1 MB: "0,1 MB") */
export function formatMegabytes(bytes: number): string {
  return `${megabytes.format(Math.max(0.1, bytes / 1_000_000))} MB`;
}

/** Local HH:MM of an instant in the browser's timezone. */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Local YYYY-MM-DD of an instant in the browser's timezone. */
export function localIsoDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 435 -> "7 h 15 min"; 10 -> "10 min" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** 128 -> "2 h 08"; 10 -> "10 min" (compact, for phases and chart tooltips) */
export function formatDurationShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

const weekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" });

/** "2026-11-07" -> "Sab 7" */
export function formatWeekdayDay(date: string): string {
  return `${capitalize(weekdayShort.format(parseDate(date)).replace(".", ""))} ${Number(date.slice(8, 10))}`;
}

/** 1.4 -> "1,4" (one decimal, Italian) */
export function formatOneDecimal(value: number): string {
  return oneDecimal.format(value);
}

const fixedOneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Weigh-ins always show one decimal: 75 -> "75,0" */
export function formatWeight(kg: number): string {
  return fixedOneDecimal.format(kg);
}
