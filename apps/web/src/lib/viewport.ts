/**
 * Layout height of the app shell.
 *
 * "auto" (default): --app-height follows the visual viewport, measured again after rotations and
 * when the app comes back. After a rotation iOS Safari sizes both 100dvh and fixed elements for a
 * toolbar that is no longer on screen; the visual viewport is right there. Folding a foldable
 * iPhone can report a zero or impossible size while the app is hidden; such values are ignored.
 *
 * "dvh" / "lvh": the shell is a normal block of height 100dvh / 100lvh, with no JavaScript
 * (as in other installed web apps that fill a foldable iPhone after rotating). Chosen per device
 * from the temporary "Diagnostica schermo" panel, to compare the modes on real devices.
 */

export type HeightMode = "auto" | "dvh" | "lvh";
export const HEIGHT_MODES: HeightMode[] = ["auto", "dvh", "lvh"];

const MODE_KEY = "intake-height-mode";
/** Heights outside this range are transient values (app hidden, mid-fold) and are not applied. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;

export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function getHeightMode(): HeightMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === "dvh" || value === "lvh" ? value : "auto";
  } catch {
    return "auto";
  }
}

export interface ViewportSample {
  /** Seconds since the page loaded. */
  t: number;
  event: string;
  mode: HeightMode;
  inner: string;
  visual: string;
  fixed: number;
  dvh: number;
  svh: number;
  lvh: number;
  client: number;
  safeArea: string;
  orientation: string;
  standalone: boolean;
  /** The --app-height applied in "auto" mode, or null. */
  applied: number | null;
}

const LOG_SIZE = 40;
const samples: ViewportSample[] = [];
const listeners = new Set<() => void>();
let controller: { setMode(mode: HeightMode): void } | null = null;

export function viewportLog(): ViewportSample[] {
  return [...samples];
}

export function onViewportSample(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Switches the layout height mode on this device (stored) and applies it at once. */
export function setHeightMode(mode: HeightMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage unavailable: the mode still applies until the app is closed
  }
  controller?.setMode(mode);
}

/** Invisible fixed element of the given height, used to read what the browser resolves. */
function probe(css: string): HTMLDivElement {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText = `position:fixed;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;z-index:-1;${css}`;
  document.body.appendChild(element);
  return element;
}

export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  const timers: number[] = [];
  let mode = getHeightMode();

  // Folding/unfolding resizes the inset: 0 probe without a window event
  const fixed = probe("bottom:0");
  const dvh = probe("height:100dvh");
  const svh = probe("height:100svh");
  const lvh = probe("height:100lvh");
  const safe = probe("padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)");
  const height = (element: HTMLElement) => Math.round(element.getBoundingClientRect().height);

  const measure = (event: string) => {
    const vv = window.visualViewport;
    const visualHeight = vv ? vv.height * vv.scale : window.innerHeight;
    let applied: number | null = null;
    if (mode === "auto") {
      const valid = document.visibilityState === "visible" && visualHeight >= MIN_HEIGHT && visualHeight <= MAX_HEIGHT;
      if (valid) {
        applied = Math.round(visualHeight);
        root.style.setProperty("--app-height", `${applied}px`);
      } else {
        root.style.removeProperty("--app-height");
      }
    }
    // The document never scrolls (only .shell-main does); undo any offset left by the rotation
    if (window.scrollY !== 0) window.scrollTo(0, 0);

    const style = getComputedStyle(safe);
    samples.push({
      t: Math.round(performance.now() / 100) / 10,
      event,
      mode,
      inner: `${window.innerWidth}×${window.innerHeight}`,
      visual: vv ? `${Math.round(vv.width)}×${Math.round(vv.height)}@${Math.round(vv.scale * 100) / 100}` : "-",
      fixed: height(fixed),
      dvh: height(dvh),
      svh: height(svh),
      lvh: height(lvh),
      client: root.clientHeight,
      safeArea: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => Math.round(parseFloat(v))).join("/"),
      orientation: screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait"),
      standalone: isStandalone(),
      applied,
    });
    if (samples.length > LOG_SIZE) samples.shift();
    listeners.forEach((listener) => listener());
  };

  const applyMode = (next: HeightMode) => {
    mode = next;
    if (mode === "auto") delete root.dataset.heightMode;
    else {
      root.dataset.heightMode = mode;
      root.style.removeProperty("--app-height");
    }
    measure(`mode:${mode}`);
  };
  controller = { setMode: applyMode };

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
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure("observer"));
  observer?.observe(fixed);

  applyMode(mode);
  return () => {
    controller = null;
    timers.forEach(clearTimeout);
    observer?.disconnect();
    [fixed, dvh, svh, lvh, safe].forEach((element) => element.remove());
    for (const [target, name, handler] of handlers) target.removeEventListener(name, handler);
  };
}
