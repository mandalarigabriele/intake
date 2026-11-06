/**
 * Keeps --app-height equal to the height the user can actually see.
 *
 * After a rotation iOS Safari sizes both 100dvh and fixed elements for a toolbar state that is
 * no longer on screen: the layout was first cut at the bottom (dvh), then ended early with an
 * empty band below it (position: fixed). The visual viewport is measured instead, unscaled so a
 * pinch zoom does not shrink the layout, and measured again once the rotation has settled.
 *
 * Folding or unfolding a foldable iPhone can report a zero or impossible size while the app is
 * hidden; such values are ignored (the CSS falls back to 100dvh) and the height is measured again
 * when the app becomes visible.
 *
 * Known limit: on a foldable iPhone the installed app's web view itself is 82 px short after
 * rotating from portrait to landscape (an iOS bug, with any status bar style), which no page code
 * can fill; launching the app in landscape gives the full height.
 */

/** Heights outside this range are transient values (app hidden, mid-fold) and are not applied. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;

/** Key of a value stored by an earlier version (remembered landscape heights); no longer used. */
const OBSOLETE_KEY = "intake-landscape-heights";

export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  const timers: number[] = [];

  try {
    localStorage.removeItem(OBSOLETE_KEY);
  } catch {
    // Storage unavailable: nothing to clean up
  }

  // Invisible element pinned to the viewport: folding/unfolding resizes it without a window event
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1";
  document.body.appendChild(probe);

  const measure = () => {
    const vv = window.visualViewport;
    const height = vv ? vv.height * vv.scale : window.innerHeight;
    const valid = document.visibilityState === "visible" && height >= MIN_HEIGHT && height <= MAX_HEIGHT;
    if (valid) root.style.setProperty("--app-height", `${Math.round(height)}px`);
    else root.style.removeProperty("--app-height");
    // The document never scrolls (only .shell-main does); undo any offset left by the rotation
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };

  const update = () => {
    measure();
    timers.splice(0).forEach(clearTimeout);
    // Safari reports the final size a little after the resize/orientationchange events
    for (const delay of [100, 300, 700, 1500]) timers.push(window.setTimeout(measure, delay));
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") update();
  };
  const windowEvents = ["resize", "orientationchange", "pageshow", "focus"] as const;
  for (const name of windowEvents) window.addEventListener(name, update);
  document.addEventListener("visibilitychange", onVisible);
  window.visualViewport?.addEventListener("resize", update);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  observer?.observe(probe);

  measure();
  return () => {
    timers.forEach(clearTimeout);
    observer?.disconnect();
    probe.remove();
    for (const name of windowEvents) window.removeEventListener(name, update);
    document.removeEventListener("visibilitychange", onVisible);
    window.visualViewport?.removeEventListener("resize", update);
  };
}
