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
