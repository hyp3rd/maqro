"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { listDailyLogs, todayKey, type DailyLog } from "@/lib/db";
import {
  computeStreak,
  nextMilestone,
  reachedMilestone,
  type StreakState,
} from "@/lib/streaks";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { toast } from "sonner";

const CELEBRATION_KEY = "maqro:streak:last-celebrated";

/** Compact streak indicator surfaced on the daily-use surfaces
 *  (DailyTotals header) so the user sees their current run every
 *  time they open the app — not only when they navigate to
 *  Progress. Doubles as the milestone celebrator: the first time
 *  the current streak crosses a `STREAK_MILESTONES` threshold,
 *  fires a one-shot toast.
 *
 *  Loads logs directly from IDB (subscribed to the dailyLogs
 *  data-bus revision so the chip refreshes when a meal is added,
 *  removed, or synced from a peer device). Renders nothing while
 *  loading and when the streak is 0 — a chip reading "🔥 0" is
 *  worse than no chip; the empty state already lives on Progress
 *  ("Log a meal today to start a streak"), and putting it here
 *  too would be noisy chrome on every page load.
 *
 *  Why a separate component (not folded into DailyTotals): the
 *  streak needs the FULL log history, but DailyTotals only
 *  receives one day's totals as props. Lifting the history fetch
 *  up to MealPlanner would force unrelated parents to know about
 *  streaks. Encapsulating it here keeps the dependency localized. */
export function StreakChip() {
  const state = useStreakState();
  useMilestoneCelebration(state);

  if (state === null || state.current === 0) return null;

  const next = nextMilestone(state.current);
  const isBest = state.current >= state.longest;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            // Live region — when the milestone celebration fires
            // we change the streak value, and assistive tech
            // benefits from announcement. `polite` so it queues
            // behind any user-initiated speech.
            aria-live="polite"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 text-[11px] font-medium text-foreground"
          >
            <Flame
              className="h-3 w-3 text-amber-500"
              aria-hidden
            />
            <span className="font-mono tabular-nums">
              {state.current}
              <span className="ml-0.5 text-muted-foreground">d</span>
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="max-w-[14rem] text-xs"
        >
          <p className="font-medium text-foreground">
            {state.current}-day logging streak
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {next
              ? `${next - state.current} day${
                  next - state.current === 1 ? "" : "s"
                } until your next milestone (${next}).`
              : "You've hit every milestone. Keep going."}
          </p>
          {!isBest && (
            <p className="mt-0.5 text-muted-foreground">
              All-time best: {state.longest} days.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Read + compute pattern broken out so the celebrator can share
 *  the same state without two IDB reads. Returns `null` while the
 *  initial fetch is in flight so callers can short-circuit
 *  rendering during the brief loading window. */
function useStreakState(): StreakState | null {
  const [logs, setLogs] = useState<DailyLog[] | null>(null);
  const rev = useDataRev("dailyLogs");

  useEffect(() => {
    let cancelled = false;
    listDailyLogs()
      .then((rows) => {
        if (cancelled) return;
        setLogs(rows);
      })
      .catch(() => {
        if (cancelled) return;
        // IDB failure: treat as empty rather than thrash on retry.
        // The streak just won't appear; the rest of the app still
        // works. Storage errors surface via the storage banner.
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  if (logs === null) return null;
  return computeStreak(logs, todayKey());
}

/** Fires a one-shot toast the first time the current streak
 *  crosses a milestone. Persists the highest celebrated milestone
 *  in localStorage so subsequent renders don't re-fire. The check
 *  runs on every state change, but the localStorage gate keeps
 *  the toast from spamming.
 *
 *  Why one-shot per milestone (not per day): celebrating "you
 *  logged today!" every single day is dopamine theatre. The user
 *  gets a meaningful nudge only when they cross a new threshold —
 *  which is rare by design (3, 7, 14, 30, 60, 100, 180, 365). */
function useMilestoneCelebration(state: StreakState | null): void {
  useEffect(() => {
    if (!state) return;
    const reached = reachedMilestone(state.current);
    if (reached === null) return;
    let lastCelebrated = 0;
    try {
      const raw = window.localStorage.getItem(CELEBRATION_KEY);
      if (raw) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed >= 0) lastCelebrated = parsed;
      }
    } catch {
      // Private mode / quota — silently skip persistence. The
      // worst case is the user gets the celebration twice if
      // they reach the same milestone in two sessions; better
      // than crashing on a localStorage write.
    }
    if (reached <= lastCelebrated) return;
    try {
      window.localStorage.setItem(CELEBRATION_KEY, String(reached));
    } catch {
      // See above.
    }
    toast.success(`🔥 ${reached}-day streak!`, {
      description:
        reached <= 7
          ? "Habit forming. Keep showing up."
          : reached <= 30
            ? "This is the part where it sticks."
            : "Genuinely impressive consistency.",
      duration: 6000,
    });
  }, [state]);
}
