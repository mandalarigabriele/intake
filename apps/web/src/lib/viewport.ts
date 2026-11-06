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
 * when the app becomes visible. Every measurement is kept in a short log for the "Diagnostica
 * schermo" panel.
 */

/** Installed home-screen app (no browser toolbar). */
export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * In the installed app iOS reports a height that is short by about a status bar after a rotation,
 * and no event corrects it. The app then fills the whole screen, so the screen side for the current
 * orientation is the real height. It is used only when the width shows the app is full screen
 * (not iPad Split View) and the gap is that small, so other layouts keep the measured value.
 */
export function standaloneHeight(measured: number, width: number, screenWidth: number, screenHeight: number): number {
  const long = Math.max(screenWidth, screenHeight);
  const short = Math.min(screenWidth, screenHeight);
  const landscape = width > measured;
  const fullWidth = landscape ? long : short;
  const fullHeight = landscape ? short : long;
  const gap = fullHeight - measured;
  return Math.abs(width - fullWidth) <= 2 && gap > 0 && gap <= 150 ? fullHeight : measured;
}

/** Heights outside this range are transient values (app hidden, mid-fold) and are not applied. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;

export interface ViewportSample {
  /** Milliseconds since the page loaded. */
  t: number;
  event: string;
  innerWidth: number;
  innerHeight: number;
  vvWidth: number | null;
  vvHeight: number | null;
  vvScale: number | null;
  vvOffsetTop: number | null;
  screenWidth: number;
  screenHeight: number;
  clientWidth: number;
  clientHeight: number;
  /** Size of a position: fixed; inset: 0 element (what the layout used before --app-height). */
  fixedWidth: number;
  fixedHeight: number;
  /** env(safe-area-inset-*) as top/right/bottom/left. */
  safeArea: string;
  orientation: string;
  standalone: boolean;
  visibility: DocumentVisibilityState;
  /** The --app-height applied, or null when the measurement was ignored. */
  applied: number | null;
}

const LOG_SIZE = 40;
const samples: ViewportSample[] = [];
const listeners = new Set<() => void>();

/** Recent measurements, oldest first. */
export function viewportLog(): ViewportSample[] {
  return [...samples];
}

/** Calls `listener` after every measurement; returns the unsubscribe function. */
export function onViewportSample(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Invisible element pinned to the viewport: its size and padding expose inset: 0 and the safe areas. */
function createProbe(): HTMLDivElement {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  return probe;
}

export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  const timers: number[] = [];
  const probe = createProbe();

  const measure = (event: string) => {
    const vv = window.visualViewport;
    let height = vv ? vv.height * vv.scale : window.innerHeight;
    if (isStandalone()) height = standaloneHeight(height, window.innerWidth, window.screen.width, window.screen.height);
    const valid = document.visibilityState === "visible" && height >= MIN_HEIGHT && height <= MAX_HEIGHT;
    if (valid) root.style.setProperty("--app-height", `${Math.round(height)}px`);
    else root.style.removeProperty("--app-height");
    // The document never scrolls (only .shell-main does); undo any offset left by the rotation
    if (window.scrollY !== 0) window.scrollTo(0, 0);

    samples.push({
      t: Math.round(performance.now()),
      event,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      vvWidth: vv ? Math.round(vv.width) : null,
      vvHeight: vv ? Math.round(vv.height) : null,
      vvScale: vv ? Math.round(vv.scale * 100) / 100 : null,
      vvOffsetTop: vv ? Math.round(vv.offsetTop) : null,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      fixedWidth: Math.round(probe.getBoundingClientRect().width),
      fixedHeight: Math.round(probe.getBoundingClientRect().height),
      safeArea: (() => {
        const style = getComputedStyle(probe);
        return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => Math.round(parseFloat(v))).join("/");
      })(),
      orientation: screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait"),
      standalone: isStandalone(),
      visibility: document.visibilityState,
      applied: valid ? Math.round(height) : null,
    });
    if (samples.length > LOG_SIZE) samples.shift();
    listeners.forEach((listener) => listener());
  };

  const update = (event: string) => {
    measure(event);
    timers.splice(0).forEach(clearTimeout);
    // Safari reports the final size a little after the resize/orientationchange events
    for (const delay of [100, 300, 700, 1500]) timers.push(window.setTimeout(() => measure(`${event}+${delay}`), delay));
  };

  const handlers: Array<[EventTarget, string, () => void]> = [
    [window, "resize", () => update("resize")],
    [window, "orientationchange", () => update("orientationchange")],
    [window, "pageshow", () => update("pageshow")],
    [window, "focus", () => update("focus")],
    [document, "visibilitychange", () => document.visibilityState === "visible" && update("visible")],
  ];
  if (window.visualViewport) handlers.push([window.visualViewport, "resize", () => update("vv-resize")]);
  for (const [target, name, handler] of handlers) target.addEventListener(name, handler);

  // Catches size changes that fire no window event (e.g. after unfolding)
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure("observer"));
  observer?.observe(probe);

  measure("start");
  return () => {
    timers.forEach(clearTimeout);
    observer?.disconnect();
    probe.remove();
    for (const [target, name, handler] of handlers) target.removeEventListener(name, handler);
  };
}
