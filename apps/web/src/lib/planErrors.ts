import { ApiError } from "../api/client";
import { t } from "./strings";

/** The message of a failed AI request of the plan (generation, replacement, estimate, alternative), worded for plans. */
export function planErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  return (code && t.planGen.errors[code]) || t.planGen.errors.recognition_failed!;
}
