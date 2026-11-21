import type { DayAlternative } from "@intake/shared";

const KEY = "intake.dayAlternative";

/** The proposal handed to the meal screen (it lives in the tab only: nothing of it is stored on the server). */
export function saveAlternativeDraft(alternative: DayAlternative): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(alternative));
  } catch {
    // Storage can be blocked (private window): the meal screen then says the proposal is gone
  }
}

export function readAlternativeDraft(): DayAlternative | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DayAlternative) : null;
  } catch {
    return null;
  }
}
