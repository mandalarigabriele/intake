import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { t } from "../lib/strings";

/** Pull distance (after resistance) that triggers a refresh on release. */
const THRESHOLD = 64;
/** The indicator never grows past this. */
const MAX_PULL = 96;
/** Finger movement is halved, so the pull feels like it has some resistance. */
const RESISTANCE = 0.5;
/** The spinner stays at least this long, so a fast refresh is still visible. */
const MIN_SPIN_MS = 500;

type Phase = "idle" | "pulling" | "ready" | "refreshing";

/**
 * Pull down at the top of a screen to refetch its data. The content area is the scroll container and contains its
 * own overscroll, so neither the installed home-screen app nor Safari has a native pull-to-refresh here; this one
 * refetches the queries on screen (React Query) without reloading the page.
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>): { pull: number; phase: Phase } {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let distance = 0;
    let tracking = false;

    const reset = () => {
      start = null;
      tracking = false;
      distance = 0;
    };

    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1 || el.scrollTop > 0) return reset();
      start = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      tracking = false;
      distance = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!start || busy.current) return;
      const dx = e.touches[0]!.clientX - start.x;
      const dy = e.touches[0]!.clientY - start.y;
      if (!tracking) {
        // Only a downward, mostly vertical gesture from the very top is a pull (charts and strips scroll sideways)
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > dy || el.scrollTop > 0) {
          start = null;
          return;
        }
        tracking = true;
      }
      distance = Math.min(Math.max(dy, 0) * RESISTANCE, MAX_PULL);
      if (e.cancelable) e.preventDefault();
      setPull(distance);
      setPhase(distance >= THRESHOLD ? "ready" : "pulling");
    };

    const onEnd = async () => {
      if (!tracking) return reset();
      const trigger = distance >= THRESHOLD;
      reset();
      if (!trigger) {
        setPull(0);
        setPhase("idle");
        return;
      }
      busy.current = true;
      setPull(THRESHOLD);
      setPhase("refreshing");
      const started = Date.now();
      try {
        await queryClient.refetchQueries({ type: "active" });
      } finally {
        const wait = MIN_SPIN_MS - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        busy.current = false;
        setPull(0);
        setPhase("idle");
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, queryClient]);

  return { pull, phase };
}

/** The indicator above the content: grows with the pull, then spins while the data is refetched. */
export function PullIndicator({ pull, phase }: { pull: number; phase: Phase }) {
  const label = phase === "refreshing" ? t.refresh.refreshing : phase === "ready" ? t.refresh.release : t.refresh.pull;
  return (
    <div className="ptr" data-phase={phase} style={{ height: pull }} aria-hidden={phase !== "refreshing"}>
      <div className="ptr-content" role={phase === "refreshing" ? "status" : undefined} style={{ opacity: Math.min(pull / THRESHOLD, 1) }}>
        {phase === "refreshing" ? <span className="ptr-spinner" /> : <span className="ptr-arrow" data-ready={phase === "ready" || undefined}>↓</span>}
        <span>{label}</span>
      </div>
    </div>
  );
}
