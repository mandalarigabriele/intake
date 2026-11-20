/**
 * Which part of Piano opens first: the meal plan (default) or Il tuo fabbisogno. Chosen in Impostazioni › Aspetto
 * and kept per device, like the theme. A `?vista=` in the address wins, so coming back from the needs page keeps it.
 */
export type PlanTab = "plan" | "needs";

const STORAGE_KEY = "intake.planTab";

/** The `vista` values in the address: /piano?vista=fabbisogno */
export const PLAN_TAB_PARAM: Record<PlanTab, string> = { plan: "pasti", needs: "fabbisogno" };

export function preferredPlanTab(): PlanTab {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "needs" ? "needs" : "plan";
  } catch {
    return "plan";
  }
}

export function setPreferredPlanTab(tab: PlanTab): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, tab);
  } catch {
    // Storage blocked: the meal plan stays first
  }
}

export function planTabFromSearch(search: string): PlanTab | null {
  const value = new URLSearchParams(search).get("vista");
  return value === PLAN_TAB_PARAM.needs ? "needs" : value === PLAN_TAB_PARAM.plan ? "plan" : null;
}
