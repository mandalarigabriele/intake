import { isStandalone } from "./push";

/**
 * Layout height of the app shell.
 *
 * Installed home-screen app: the shell is a normal block of height 100lvh, sized by CSS alone, except when the
 * page starts below the status bar (trackStatusBar): then 100svh.
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
    return trackStatusBar(root);
  }

  const timers: number[] = [];
  // Invisible element pinned to the viewport: folding/unfolding resizes it without a window event
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1";
  document.body.appendChild(probe);

  const measure = () => {
    // While a text field has focus the keyboard is open: Safari shrinks the visual viewport and scrolls the
    // page to the field. Following it (new height, scroll back to 0) made the page jump up and down; the
    // keyboard is left to Safari and the height is measured again when the field loses focus.
    if (editableFocused()) return;
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
  // Keyboard closed: measure once focus has really left the fields (focusout fires before the next focus)
  const onFocusOut = () => window.setTimeout(() => !editableFocused() && update(), 0);
  document.addEventListener("focusout", onFocusOut);
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
    document.removeEventListener("focusout", onFocusOut);
    window.visualViewport?.removeEventListener("resize", update);
  };
}

/** Height in CSS pixels of an invisible element with the given style, or 0 when it can't be measured. */
function probeHeight(css: string): number {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(el);
  const height = el.getBoundingClientRect().height;
  el.remove();
  return height;
}

/**
 * Installed app: whether the page starts below the status bar. With the "default" status bar style, iOS 18 on an
 * iPhone with a notch places the page below the status bar (safe-area-inset-top 0) but still reports 100lvh as the
 * whole screen: on an iPhone 402 × 874 the page is 812 high and 100lvh is 874, so a shell of 100lvh put the tab bar
 * 62 px below the screen edge, and after switching apps the document scrolled by those 62 px. Only then
 * (`data-below-status-bar`, in portrait) the shell uses 100svh, the height of the page; everywhere else, including the
 * foldable iPhone whose page reaches the top of the screen and every iPhone in landscape, it stays 100lvh (base.css).
 */
function trackStatusBar(root: HTMLElement): () => void {
  const check = () => {
    if (document.visibilityState !== "visible") return;
    const safeTop = probeHeight("height:env(safe-area-inset-top)");
    const large = probeHeight("height:100lvh");
    const small = probeHeight("height:100svh");
    // Portrait only: in landscape safe-area-inset-top is 0 on every iPhone (the island is on the side), and on the
    // foldable iPhone 100svh is 82 px short after a rotation, so the check would shrink the shell and leave a black band
    // under it. Landscape keeps 100lvh, which is right there.
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const below = portrait && safeTop === 0 && small >= MIN_HEIGHT && large - small >= 1;
    if (below) root.dataset.belowStatusBar = "";
    else delete root.dataset.belowStatusBar;
    // The document never scrolls (only .shell-main does); undo an offset left from before the shell fitted
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  // Safari reports the final orientation and sizes a little after the events: check again shortly after
  const timers: number[] = [];
  const update = () => {
    check();
    timers.splice(0).forEach(clearTimeout);
    for (const delay of [150, 500, 1200]) timers.push(window.setTimeout(check, delay));
  };
  const events = ["resize", "orientationchange", "pageshow"] as const;
  for (const name of events) window.addEventListener(name, update);
  document.addEventListener("visibilitychange", update);
  check();
  return () => {
    timers.forEach(clearTimeout);
    for (const name of events) window.removeEventListener(name, update);
    document.removeEventListener("visibilitychange", update);
    delete root.dataset.standalone;
    delete root.dataset.belowStatusBar;
  };
}

/** A text field (or anything editable) has focus, so the on-screen keyboard is likely open. */
function editableFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(el.type);
}
