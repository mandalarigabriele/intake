import { isStandalone } from "./push";

/**
 * Layout height of the app shell.
 *
 * Installed home-screen app: the shell is a normal block of height 100lvh, sized by CSS alone.
 * There is no browser toolbar, so the large viewport is the whole screen. On a foldable iPhone,
 * after rotating or switching apps, iOS reports a height 82 px short through innerHeight, the
 * visual viewport, fixed elements and svh, and 100dvh can stay stuck on an intermediate value;
 * device logs showed 100lvh at the full screen height every time (951 portrait, 669 landscape).
 *
 * Safari (browser): --app-height follows the visual viewport, measured again after rotations and
 * when the page comes back, because Safari sizes 100dvh and fixed elements for a toolbar that is
 * no longer on screen. Zero or impossible sizes (page hidden, folding) are ignored.
 */

/** Heights outside this range are transient values (page hidden, mid-fold) and are not applied. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;

/** Key of a value stored by the temporary diagnostics panel; no longer used. */
const OBSOLETE_KEY = "intake-height-mode";

export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  try {
    localStorage.removeItem(OBSOLETE_KEY);
  } catch {
    // Storage unavailable: nothing to clean up
  }

  if (isStandalone()) {
    root.dataset.standalone = "";
    root.style.removeProperty("--app-height");
    return () => {
      delete root.dataset.standalone;
    };
  }

  const timers: number[] = [];
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
