/**
 * Keeps --app-height equal to the height the user can actually see.
 *
 * After a rotation iOS Safari sizes both 100dvh and fixed elements for a toolbar state that is
 * no longer on screen: the layout was first cut at the bottom (dvh), then ended early with an
 * empty band below it (position: fixed). The visual viewport is measured instead, unscaled so a
 * pinch zoom does not shrink the layout, and measured again once the rotation has settled.
 */
/** Installed home-screen app (no browser toolbar). */
function isStandalone(): boolean {
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

export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  const timers: number[] = [];

  const measure = () => {
    const vv = window.visualViewport;
    let height = vv ? vv.height * vv.scale : window.innerHeight;
    if (isStandalone()) height = standaloneHeight(height, window.innerWidth, window.screen.width, window.screen.height);
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    // The document never scrolls (only .shell-main does); undo any offset left by the rotation
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };

  const update = () => {
    measure();
    timers.splice(0).forEach(clearTimeout);
    // Safari reports the final size a little after the resize/orientationchange events
    for (const delay of [100, 300, 700]) timers.push(window.setTimeout(measure, delay));
  };

  measure();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  window.visualViewport?.addEventListener("resize", update);
  return () => {
    timers.forEach(clearTimeout);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    window.visualViewport?.removeEventListener("resize", update);
  };
}
