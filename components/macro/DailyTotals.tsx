"use client";

import { MacroReadout } from "@/components/today/MacroReadout";
import { TodayGauge } from "@/components/today/TodayGauge";
import { relativeDay } from "@/lib/today/timeline";
import React, { useEffect } from "react";
import { toast } from "sonner";
import {
  CalculatedValues,
  MacroBreakdown,
  TotalMacros,
} from "../../components/macro/types";

interface DailyTotalsProps {
  calculatedValues: CalculatedValues;
  totalMacros: TotalMacros;
  /** Optional per-day sub-macro totals - sugars / fiber / fat subtypes.
   *  Rendered as a collapsible breakdown below the gauge. Only rows whose
   *  value the aggregator populated render (others were never seen in
   *  today's foods, so showing "0g" would mislead). When the whole object
   *  is empty, the breakdown is hidden entirely. */
  breakdown?: MacroBreakdown;
  /** Displayed day + today's key. Used to note "calorie target reached"
   *  only while viewing today — never when scrolling back to a past day
   *  that already crossed its target — and to word the gauge's centre
   *  ("left today" only makes sense for today; a past day came in "under
   *  target"; a future day has kcal "to plan"). `calculatedValues` is the
   *  DISPLAYED day's own target. */
  selectedDate: string;
  today: string;
}

const GOAL_CELEBRATION_PREFIX = "maqro:goal:reached:";

/** One-shot "today's calorie target reached" note, keyed by day in
 *  localStorage so it fires exactly once — not on every subsequent add, and
 *  not again after a reload. Mirrors the streak-milestone guard in
 *  StreakChip. Gated to today so reviewing a past day never re-fires it.
 *  A plain (neutral) toast stating the fact: reaching or passing the target
 *  is neither a success nor a failure (wellbeing rule). */
function useGoalReachedCelebration(
  reached: boolean,
  isToday: boolean,
  dayKey: string,
): void {
  useEffect(() => {
    if (!isToday || !reached) return;
    const key = `${GOAL_CELEBRATION_PREFIX}${dayKey}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // Private mode: can't persist, so skip the toast too — otherwise it
      // would re-fire on every render with no flag to suppress it.
      return;
    }
    toast("Today's calorie target reached");
  }, [reached, isToday, dayKey]);
}

const SUB_MACRO_LABELS: Record<keyof MacroBreakdown, string> = {
  sugars: "Sugars",
  addedSugars: "Added sugars",
  fiber: "Fiber",
  saturatedFat: "Saturated fat",
  transFat: "Trans fat",
  monoFat: "Mono-unsat. fat",
  polyFat: "Poly-unsat. fat",
};

/** The Today energy panel (Instrument): the ring gauge (eaten vs the
 *  displayed day's own target, with the three macro arcs) beside its mono
 *  readout, then the sub-macro breakdown (the logging streak and Share
 *  sit in the Today header's row). The
 *  gauge's centre is the headline — how many kcal are left, worded for the
 *  day — and a polite live region, so logging food is announced. Over and
 *  under are stated, never judged. */
const DailyTotals: React.FC<DailyTotalsProps> = ({
  calculatedValues,
  totalMacros,
  breakdown,
  selectedDate,
  today,
}) => {
  const targetCalories = Math.round(calculatedValues.targetCalories);
  const consumedCalories = Math.round(totalMacros.calories);
  const isToday = selectedDate === today;
  const goalReached = targetCalories > 0 && consumedCalories >= targetCalories;
  useGoalReachedCelebration(goalReached, isToday, today);
  const breakdownKeys = (
    Object.keys(SUB_MACRO_LABELS) as Array<keyof MacroBreakdown>
  ).filter((k) => typeof breakdown?.[k] === "number");

  return (
    // A plain block: the Today section around it is the landmark, and a
    // region inside a region only adds noise to the landmark list.
    <div data-part="energy">
      {/* Side by side from 22rem of panel (a 390 px phone and up). In a
          narrower panel the readout beside the gauge would squeeze its
          labels to an ellipsis, so the gauge centres above a 2 × 2
          readout (a 360 or 320 px phone; on the narrowest, each cell puts
          its "N g left" under the figure, see MacroReadout). Keyed off
          the panel's own width, not the viewport, since the desktop
          columns size it too. */}
      <div className="@container">
        <div
          data-part="gauge-row"
          className="flex flex-col items-center gap-4 @min-[22rem]:flex-row sm:gap-6"
        >
          <TodayGauge
            eaten={totalMacros}
            targets={calculatedValues}
            when={relativeDay(selectedDate, today)}
            className="w-[10.5rem] sm:w-44"
          />
          <MacroReadout
            eaten={totalMacros}
            targets={calculatedValues}
            className="w-full grid-cols-2 gap-x-4 @min-[22rem]:w-auto @min-[22rem]:min-w-0 @min-[22rem]:flex-1 @min-[22rem]:grid-cols-1"
          />
        </div>
      </div>
      {/* The streak and Share sit in the Today header's row; only the
          sub-macro breakdown, when the day's foods have one, follows. */}
      {breakdown && breakdownKeys.length > 0 && (
        <details className="mt-2 text-label">
          <summary className="flex min-h-touch-9 cursor-pointer select-none items-center text-muted-foreground hover:text-foreground">
            Breakdown ({breakdownKeys.length} sub-macro
            {breakdownKeys.length === 1 ? "" : "s"})
          </summary>
          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-xs tabular-nums sm:grid-cols-2">
            {breakdownKeys.map((k) => (
              <div
                key={k}
                className="flex items-baseline justify-between gap-2"
              >
                <dt className="text-muted-foreground">{SUB_MACRO_LABELS[k]}</dt>
                <dd className="text-foreground">{breakdown[k]} g</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
};

export default DailyTotals;
