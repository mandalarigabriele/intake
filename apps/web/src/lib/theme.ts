/**
 * Theme preference: follow the system by default, or force light/dark. Stored per device.
 * index.html applies the stored value before first paint to avoid a flash.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "intake-theme";
const THEME_COLORS = { light: "#f4f5f1", dark: "#121412" };

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;

  // iOS status bar / browser chrome: one meta per scheme, overridden when the choice is manual
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.dataset.scheme as "light" | "dark" | undefined;
    if (!scheme) continue;
    meta.content = preference === "system" ? THEME_COLORS[scheme] : THEME_COLORS[preference];
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage unavailable (private mode): the choice still applies for this session
  }
  applyTheme(preference);
}

/**
 * Replaces the theme-color metas with fresh copies. iOS Safari tints its status bar from fixed
 * elements such as a sheet's dark backdrop and can keep that tint after the sheet closes; a new
 * element makes it evaluate the color again.
 */
export function refreshThemeColor(): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.replaceWith(meta.cloneNode(true));
  }
}
