"use client";

import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";

/** Pull-to-refresh wrapper for a scrollable container.
 *
 *  Crucially, this is built on NATIVE scrolling + touch events, not a
 *  motion drag. A drag-based version (`drag="y"` + `touchAction`)
 *  fights the browser's own vertical scroll — it either captures every
 *  vertical gesture (breaking scroll) or never reliably engages. The
 *  only correct way to overlay a pull-to-refresh on a real scroll
 *  container is to leave native scrolling intact and intercept ONLY the
 *  over-pull at `scrollTop === 0`:
 *
 *    - The container scrolls normally (`overflow-y-auto`,
 *      `touch-action: pan-y`).
 *    - On `touchstart` we record the start Y, but only arm the pull if
 *      the container is already scrolled to the very top.
 *    - On `touchmove` (a NON-passive listener so we can
 *      `preventDefault`) we engage only while the finger moves DOWN and
 *      the container is still at the top. We translate the content by a
 *      damped fraction of the drag and suppress the browser's rubber-
 *      band. Any upward move hands control straight back to native
 *      scroll.
 *    - On `touchend`, past the threshold we fire `onRefresh`; otherwise
 *      we spring back.
 *
 *  Inert on mouse / non-touch / reduced-motion devices — they keep a
 *  plain scroll container with zero gesture wiring. */
const PULL_THRESHOLD_PX = 70;
const PULL_MAX_PX = 120;
/** Damping applied to raw finger travel so the content trails the
 *  finger (the standard iOS feel — you pull 120 px to move the sheet
 *  ~70). */
const PULL_DAMPING = 0.5;

export type PullToRefreshProps = {
  children: ReactNode;
  onRefresh: () => Promise<void> | void;
  /** Applied to the outer scroll container. Pass min-height / max-h
   *  here; the `overflow-y-auto` is owned by this component. */
  className?: string;
  /** Imperative override — when true the gesture is fully disabled
   *  (e.g. while a separate sheet is open and intercepting touches). */
  disabled?: boolean;
};

export function PullToRefresh({
  children,
  onRefresh,
  className,
  disabled = false,
}: PullToRefreshProps) {
  const isTouch = useCoarsePointer();
  const gesturesActive = isTouch && !disabled;

  const containerRef = useRef<HTMLDivElement>(null);
  // Pull distance in px (already damped) and whether a refresh is
  // running — both drive the visual. Kept in state because they paint;
  // the per-touch bookkeeping lives in refs to avoid re-render churn
  // mid-gesture.
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const refreshingRef = useRef(false);
  // Mirror `pull` into a ref so the touchend handler (captured once per
  // effect run) reads the latest value without re-subscribing on every
  // pixel of movement. Synced via an effect — React 19 forbids writing
  // a ref during render.
  const pullRef = useRef(0);
  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    // Pin the indicator at the threshold while the refresh runs.
    setPull(PULL_THRESHOLD_PX);
    try {
      await onRefresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPull(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !gesturesActive) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current || !el || e.touches.length !== 1) return;
      // Only a candidate when already at the very top — otherwise this
      // is an ordinary scroll and we never want to interfere.
      if (el.scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
        armedRef.current = false;
      } else {
        startYRef.current = null;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (refreshingRef.current || startYRef.current === null || !el) return;
      const dy = e.touches[0].clientY - startYRef.current;
      // Upward move, or the container scrolled off the top mid-gesture:
      // abandon the pull and let native scroll take over.
      if (dy <= 0 || el.scrollTop > 0) {
        if (armedRef.current) {
          armedRef.current = false;
          setPull(0);
        }
        startYRef.current = null;
        return;
      }
      // Pulling down at the top — claim the gesture. preventDefault
      // suppresses the browser's overscroll/bounce so only our
      // indicator moves. (Listener is registered non-passive below.)
      armedRef.current = true;
      e.preventDefault();
      setPull(Math.min(dy * PULL_DAMPING, PULL_MAX_PX));
    }

    function onTouchEnd() {
      if (refreshingRef.current) return;
      const armed = armedRef.current;
      armedRef.current = false;
      startYRef.current = null;
      if (armed && pullRef.current >= PULL_THRESHOLD_PX) {
        void runRefresh();
      } else if (armed) {
        setPull(0);
      }
    }

    // touchmove MUST be non-passive so preventDefault works; the others
    // can stay passive (they never preventDefault).
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [gesturesActive, runRefresh]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-y-auto",
        // Suppress the browser's own pull-to-refresh / overscroll glow
        // so only ours fires.
        gesturesActive && "[overscroll-behavior-y:contain]",
        className,
      )}
    >
      {gesturesActive && pull > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-end justify-center text-[11px] text-muted-foreground"
          style={{ height: pull }}
        >
          <span className="flex items-center gap-1.5 pb-1.5">
            <Loader2
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing
              ? "Refreshing…"
              : pull >= PULL_THRESHOLD_PX
                ? "Release to refresh"
                : "Pull to refresh"}
          </span>
        </div>
      )}
      <div
        style={
          gesturesActive && pull > 0
            ? {
                transform: `translateY(${pull}px)`,
                // No transition while the finger drives it; the spring-
                // back on release is a CSS transition so it's smooth
                // without a rAF loop.
                transition: refreshing ? "transform 0.2s" : "none",
              }
            : { transition: "transform 0.2s" }
        }
      >
        {children}
      </div>
    </div>
  );
}
