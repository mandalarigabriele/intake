import type {
  HealthCoverageMetric,
  HealthDuplicate,
  HealthIgnoredGroup,
  HealthImportPreview,
  HealthPreviewMetric,
  HealthStatus,
} from "@intake/shared";
import type { HealthImportCounts, HealthStore } from "../db/healthStore.js";
import type { HealthExport, HealthMetric } from "../parsers/healthAutoExport.js";
import { mergeWorkouts, sourceLabel, type MergedWorkout } from "./healthWorkouts.js";

/** Days of the regular window before the last regular day. */
const REGULAR_WINDOW = 7;
/** Share of days with data needed in that window to call it regular. */
const REGULAR_SHARE = 0.8;
/** Below this share of days the data is irregular. */
const IRREGULAR_SHARE = 0.5;
/** Days after the break needed before warning (more than 3 days, as in docs/apple-health.md). */
const MIN_DAYS_AFTER = 4;
/** Days looked at when there is no clear break. */
const RECENT_DAYS = 14;
/** Longest coverage shown in the Apple Salute screen. */
const COVERAGE_DAYS = 90;

export interface Irregularity {
  /** Last regular day before the data stopped arriving regularly; null when there is no clear break. */
  since: string | null;
  /** Reference days after `since` (or among the recent days) and how many of them have the metric. */
  presentDays: number;
  totalDays: number;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Whether a metric stopped arriving regularly while other data (the reference days) keeps arriving.
 * Looks for the last day on which the metric was regular over the previous week and rarely present afterwards;
 * without such a break, checks the recent reference days.
 */
export function irregularity(metricDates: string[], referenceDates: string[]): Irregularity | null {
  const present = new Set(metricDates);
  const reference = [...new Set(referenceDates)].sort();
  if (reference.length === 0) return null;

  const candidates = [...present].filter((d) => reference.includes(d)).sort().reverse();
  for (const day of candidates) {
    const window = reference.filter((d) => d <= day && d > addDays(day, -REGULAR_WINDOW));
    const regular = window.filter((d) => present.has(d)).length >= REGULAR_SHARE * window.length;
    if (!regular) continue;
    const after = reference.filter((d) => d > day);
    const presentAfter = after.filter((d) => present.has(d)).length;
    if (after.length >= MIN_DAYS_AFTER && presentAfter < IRREGULAR_SHARE * after.length) {
      return { since: day, presentDays: presentAfter, totalDays: after.length };
    }
    // The most recent regular day is not followed by a gap: the data is regular
    break;
  }

  const recent = reference.slice(-RECENT_DAYS);
  const presentRecent = recent.filter((d) => present.has(d)).length;
  const lastMissing = [...recent].reverse().findIndex((d) => present.has(d));
  const missingAtEnd = lastMissing === -1 ? recent.length : lastMissing;
  if (recent.length >= MIN_DAYS_AFTER && (presentRecent < IRREGULAR_SHARE * recent.length || missingAtEnd >= MIN_DAYS_AFTER)) {
    return { since: null, presentDays: presentRecent, totalDays: recent.length };
  }
  return null;
}

/** HAE metric names → "Ignorati" groups. Anything unknown is "other". */
function ignoredGroup(name: string): HealthIgnoredGroup {
  if (name === "weight_body_mass" || name === "body_mass_index" || name === "body_fat_percentage" || name === "lean_body_mass") return "weight";
  if (name === "heart_rate") return "detail";
  if (name === "vo2_max") return "vo2max";
  if (name === "blood_oxygen_saturation" || name === "respiratory_rate" || name === "heart_rate_variability") return "vitals";
  if (name.startsWith("walking_") || name === "headphone_audio_exposure" || name === "environmental_audio_exposure" || name === "flights_climbed" || name === "stair_speed_up" || name === "stair_speed_down" || name === "six_minute_walking_test_distance") {
    return "gait";
  }
  const nutrition = [
    "dietary_", "protein", "carbohydrates", "total_fat", "saturated_fat", "monounsaturated_fat", "polyunsaturated_fat", "fiber", "caffeine",
    "cholesterol", "sodium", "potassium", "calcium", "iron", "magnesium", "manganese", "phosphorus", "zinc", "copper", "selenium", "iodine",
    "chromium", "molybdenum", "chloride", "biotin", "folate", "niacin", "riboflavin", "thiamin", "pantothenic_acid", "vitamin_", "alcohol_consumption",
  ];
  if (nutrition.some((prefix) => name.startsWith(prefix))) return "nutrition";
  return "other";
}

const GROUP_ORDER: HealthIgnoredGroup[] = ["nutrition", "weight", "private", "detail", "vo2max", "vitals", "gait", "other"];

export function ignoredGroups(ignored: HealthExport["ignored"]): HealthIgnoredGroup[] {
  const groups = new Set<HealthIgnoredGroup>(ignored.metrics.map(ignoredGroup));
  if (Object.keys(ignored.sections).length > 0) groups.add("private");
  if (ignored.routes > 0) groups.add("detail");
  return GROUP_ORDER.filter((g) => groups.has(g));
}

const localTime = (iso: string) => iso.slice(11, 16);

function duplicateOf(session: MergedWorkout): HealthDuplicate {
  const keptRecords = session.records.filter((r) => r.source === session.source);
  return {
    date: session.date,
    label: session.label,
    start: localTime(session.start),
    end: localTime(session.end),
    records: session.records.map((r) => ({ source: r.source, label: r.label, start: localTime(r.start), end: localTime(r.end) })),
    kept: session.source,
    heartRateFrom: session.heartRateFrom && session.heartRateFrom !== session.source ? session.heartRateFrom : null,
    joined: keptRecords.length > 1,
    renamed: new Set(session.records.map((r) => r.label)).size > 1,
    discarded: session.records.length - 1,
  };
}

function dailyDates(data: HealthExport, metric: HealthMetric): string[] {
  return data.daily.filter((d) => d.metric === metric).map((d) => d.date);
}

/** What an import contains and what it will change, for the preview and the result screen. */
export function importPreview(data: HealthExport, counts: HealthImportCounts): HealthImportPreview {
  const reference = [...dailyDates(data, "steps"), ...data.sleep.map((s) => s.date), ...dailyDates(data, "restingHr")];
  const metric = (key: HealthPreviewMetric, dates: string[], checkRegular: boolean) => {
    const found = irregularity(dates, reference);
    return { metric: key, days: new Set(dates).size, irregular: checkRegular && found ? { since: found.since } : null };
  };
  const metrics = [
    metric("steps", dailyDates(data, "steps"), false),
    metric("distanceKm", dailyDates(data, "distanceKm"), false),
    metric("sleep", data.sleep.map((s) => s.date), false),
    metric("restingHr", dailyDates(data, "restingHr"), false),
    metric("activeKcal", dailyDates(data, "activeKcal"), true),
    metric("restingKcal", dailyDates(data, "restingKcal"), true),
    metric("hrvMs", dailyDates(data, "hrvMs"), false),
    metric("respiratoryRate", dailyDates(data, "respiratoryRate"), false),
  ].filter((m) => m.days > 0);

  const sessions = mergeWorkouts(data.workouts);
  const families = new Map<string, number>();
  for (const s of sessions) families.set(s.family, (families.get(s.family) ?? 0) + 1);

  return {
    firstDate: counts.firstDate,
    lastDate: counts.lastDate,
    days: counts.days,
    newDays: counts.newDays,
    updatedDays: counts.updatedDays,
    metrics,
    workouts: {
      found: data.workouts.length,
      discarded: data.workouts.length - sessions.length,
      sessions: sessions.length,
      byFamily: [...families.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family)),
      duplicates: sessions.filter((s) => s.records.length > 1).map(duplicateOf),
    },
    ignored: ignoredGroups(data.ignored),
  };
}

/** True when an export has nothing Intake imports. */
export function isEmptyExport(data: HealthExport): boolean {
  return data.daily.length === 0 && data.sleep.length === 0 && data.workouts.length === 0;
}

/** Data status for the Apple Salute screen. */
export function healthStatus(store: HealthStore, today: string): HealthStatus {
  const dates = store.dates();
  const lastImport = store.imports(1)[0];
  const days = [...new Set([...Object.values(dates.daily).flat(), ...dates.sleep])].sort();
  const sessions = mergeWorkouts(store.allWorkouts());
  const reference = [...dates.daily.steps, ...dates.sleep, ...dates.daily.restingHr];
  const active = irregularity(dates.daily.activeKcal, reference);
  // Only warn while other data keeps arriving and some active energy was imported at all
  const warning = active && dates.daily.activeKcal.length > 0 ? active : null;

  const allDates = [...days, ...dates.workouts].sort();
  const firstDate = allDates[0] ?? null;
  let coverage: HealthStatus["coverage"] = null;
  if (firstDate) {
    const lastDate = allDates.at(-1)!;
    const to = lastDate > today ? lastDate : today;
    const from = firstDate > addDays(to, -(COVERAGE_DAYS - 1)) ? firstDate : addDays(to, -(COVERAGE_DAYS - 1));
    const span: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) span.push(d);
    const row = (metric: HealthCoverageMetric, present: string[], irregularAfter: string | null = null) => {
      const set = new Set(present);
      return { metric, cells: span.map((d) => (set.has(d) ? (irregularAfter && d > irregularAfter ? "i" : "p") : "m")).join("") };
    };
    coverage = {
      from,
      to,
      rows: [
        row("steps", dates.daily.steps),
        row("sleep", dates.sleep),
        row("restingHr", dates.daily.restingHr),
        row("activeKcal", dates.daily.activeKcal, warning?.since ?? null),
        row("workouts", dates.workouts),
      ],
    };
  }

  const sources = new Set<string>([...sessions.flatMap((s) => s.records.map((r) => r.source)), ...store.sleep(firstDate ?? today, today).map((n) => sourceLabel(n.source))]);
  const SOURCE_ORDER = ["Fitbit", "MERACH", "Hevy", "Bevel"];
  return {
    today,
    lastImport: lastImport ? { receivedAt: lastImport.receivedAt, kind: lastImport.kind } : null,
    firstDate: days[0] ?? null,
    lastDate: days.at(-1) ?? null,
    days: days.length,
    workouts: sessions.length,
    coverage,
    sources: [...sources]
      .filter(Boolean)
      .sort((a, b) => {
        const rank = (s: string) => (SOURCE_ORDER.includes(s) ? SOURCE_ORDER.indexOf(s) : SOURCE_ORDER.length);
        return rank(a) - rank(b) || a.localeCompare(b);
      }),
    activeEnergyWarning: warning ? { since: warning.since, presentDays: warning.presentDays, totalDays: warning.totalDays } : null,
    settings: store.settings(),
  };
}
