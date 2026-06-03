"use client";

import { useSyncExternalStore } from "react";

/** One shared 60s interval for every consumer (the fasting card + the Topbar
 *  chip). Started on the first subscribe, cleared on the last unsubscribe —
 *  so adding readers never adds timers. */
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (interval === undefined) {
    interval = setInterval(() => {
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };
}

const MS_PER_MIN = 60_000;

/** Snapshot floored to the minute so identical reads within a minute are
 *  `Object.is`-equal and don't trigger spurious re-renders. */
function getSnapshot(): number {
  return Math.floor(Date.now() / MS_PER_MIN) * MS_PER_MIN;
}

/** Current wall-clock as ms epoch, minute-aligned, re-rendering subscribers
 *  once a minute. Use for live countdowns/timers that only need
 *  minute-granular updates (the fast timer shows "3h 20m"). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Stable server snapshot avoids hydration mismatches; the client
    // re-renders with the real value immediately after hydrate.
    () => 0,
  );
}
