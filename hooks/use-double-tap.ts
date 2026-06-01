"use client";

import { useCallback, useRef, type PointerEvent } from "react";

/** Double-tap detection that doesn't double-fire single-tap.
 *
 *  The naive pattern — calling both `onClick` and `onDoubleClick`
 *  via React's synthetic events — fires the click handler TWICE on a
 *  double-tap (once on each tap). That's fine when single-click and
 *  double-click do unrelated things (single = open, double = open-in-
 *  new-window), but for our use case (single = edit a portion,
 *  double = duplicate the row) the side-effect of the first click
 *  happens before the second arrives, and a "duplicate" gesture
 *  silently opens the editor first.
 *
 *  This hook delays the single-tap handler by the double-tap window
 *  (260 ms; iOS uses ~300, Android ~250 — split the difference) so
 *  if a second tap arrives we cancel the single. Yes, every single-
 *  tap pays a 260 ms latency cost — that's the price of unambiguous
 *  semantics. For surfaces where that latency is unacceptable, just
 *  bind a normal `onClick` and skip this hook.
 *
 *  The hook intentionally uses Pointer Events (not Touch / Mouse)
 *  because Pointer is the only API that gives identical semantics
 *  on iOS Safari, Android Chrome, and desktop, AND it lets us read
 *  `pointerType` to bypass the delay on mouse devices (where the
 *  user's intent is unambiguous from the input modality). */
const DOUBLE_TAP_WINDOW_MS = 260;

export type UseDoubleTapOptions = {
  /** Fired immediately on double-tap. */
  onDoubleTap: () => void;
  /** Fired after the double-tap window expires without a second tap.
   *  Pass undefined to make this a double-tap-only surface. */
  onSingleTap?: () => void;
};

export type UseDoubleTapReturn = {
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
};

export function useDoubleTap({
  onDoubleTap,
  onSingleTap,
}: UseDoubleTapOptions): UseDoubleTapReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `null` is the "no tap is pending" marker. A numeric sentinel
  // (e.g. 0) would conflict with `performance.now()` legitimately
  // returning 0 under fake timers or right after timeOrigin — that
  // would make the very first tap look like "no prior tap" forever.
  const lastTapRef = useRef<number | null>(null);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // Mouse users get the un-delayed behaviour: their input
      // intent is single-click vs double-click, and the 260 ms delay
      // would make every click feel laggy. They also have a separate
      // affordance (the explicit row buttons) so missing the
      // double-tap-to-duplicate isn't a loss.
      if (e.pointerType === "mouse") {
        onSingleTap?.();
        return;
      }
      const now = performance.now();
      const prior = lastTapRef.current;
      if (prior != null && now - prior < DOUBLE_TAP_WINDOW_MS) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        lastTapRef.current = null;
        onDoubleTap();
        return;
      }
      lastTapRef.current = now;
      if (!onSingleTap) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSingleTap();
      }, DOUBLE_TAP_WINDOW_MS);
    },
    [onDoubleTap, onSingleTap],
  );

  return { onPointerUp };
}
