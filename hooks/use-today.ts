"use client";

import { todayKey } from "@/lib/db";
import { useSyncExternalStore } from "react";

/** Milliseconds from `now` to the next local 00:00:01. The extra second is
 * a buffer so a tiny clock skew doesn't have us recomputing the day key
 * at 23:59:59.999 and getting yesterday's date back. */
function msUntilNextMidnight(now: Date = new Date()): number {
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0,
  );
  return tomorrow.getTime() - now.getTime();
}

/** Returns the current local `YYYY-MM-DD` and re-renders subscribers
 * when the day rolls over. Survives DST transitions because we
 * recompute the next-midnight delay on every fire. */
export function useToday(): string {
  return useSyncExternalStore(
    (notify) => {
      let timer: number | undefined;
      const tick = () => {
        notify();
        schedule();
      };
      const schedule = () => {
        timer = window.setTimeout(tick, msUntilNextMidnight());
      };
      schedule();
      return () => {
        if (timer !== undefined) window.clearTimeout(timer);
      };
    },
    () => todayKey(),
    // Stable server snapshot avoids hydration mismatches; the client
    // will re-render immediately after hydrate with the real value.
    () => "",
  );
}
