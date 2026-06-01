"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to `(pointer: coarse)` via `useSyncExternalStore` —
 *  the React 19 idiom for "read a browser-API source of truth into
 *  a component" without tripping the new
 *  `react-hooks/set-state-in-effect` rule that bans `setState` calls
 *  inside `useEffect` bodies.
 *
 *  The hook returns `true` when the primary pointing device is a
 *  fingertip or stylus (every phone / tablet, plus a desktop with a
 *  touchscreen as the active input). All three touch-gesture
 *  primitives (SwipeRow, PullToRefresh, DateNavigator's day swipe)
 *  gate on this so desktop users keep the explicit button
 *  affordances and don't get accidental drag-to-delete from a mouse.
 *
 *  SSR returns `false` — the server has no notion of pointer type,
 *  and falling through to the desktop-only rendering avoids a
 *  hydration mismatch when the client later resolves to touch. On a
 *  truly-touch device, the client re-renders with `true` after
 *  hydration completes; the cost is a single re-render right after
 *  mount on the touch population that benefits from it. */
function subscribe(callback: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function getServerSnapshot() {
  return false;
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
