import type { ClockInfo } from "@intake/shared";
import { ParseError, type Parsed } from "./common.js";

/**
 * Parses the clock line shared by get_current_time and get_profile:
 *
 *   Local time now: Thursday 2026-11-05 10:02:10 (Europe/Rome). UTC now: 2026-11-05T09:02:10.540Z.
 */

const LOCAL = /Local time now:\s*(?:[A-Za-z]+\s+)?(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s*\(([^)]+)\)/;
const UTC = /UTC now:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;

export function parseClock(text: string): Parsed<ClockInfo> {
  const local = LOCAL.exec(text);
  const utc = UTC.exec(text);
  if (!local || !utc) throw new ParseError("unrecognized current time response", text);

  const time = local[2]!;
  return {
    value: {
      timezone: local[3]!.trim(),
      localDate: local[1]!,
      localTime: time.length === 5 ? `${time}:00` : time,
      utc: utc[1]!,
    },
    warnings: [],
  };
}
