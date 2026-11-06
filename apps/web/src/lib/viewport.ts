/**
 * Keeps --app-height equal to the height the user can actually see.
 *
 * After a rotation iOS Safari sizes both 100dvh and fixed elements for a toolbar state that is
 * no longer on screen: the layout was first cut at the bottom (dvh), then ended early with an
 * empty band below it (position: fixed). The visual viewport is measured instead, unscaled so a
 * pinch zoom does not shrink the layout, and measured again once the rotation has settled.
 */
export function trackViewportHeight(): () => void {
  const root = document.documentElement;
  const timers: number[] = [];

  const measure = () => {
    const vv = window.visualViewport;
    const height = vv ? vv.height * vv.scale : window.innerHeight;
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
