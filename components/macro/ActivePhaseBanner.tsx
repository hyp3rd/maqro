"use client";

import { PHASE_LABELS, phaseHasRate, phaseProgress } from "@/lib/goal-phases";
import { formatWeightRate, type UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";
import type { GoalPhase } from "./types";

/** Compact banner on the day view showing the goal phase currently driving
 *  the calorie target: "Cut · week 3 of 12 · −0.45 kg/wk · 9 wks left" plus a
 *  progress bar and a diet-break nudge when one applies. Renders nothing when
 *  no phase is active (the linear goal drives the target then). The active
 *  phase + nudge are computed upstream (where the tier is known), so this is
 *  display-only. */
export function ActivePhaseBanner({
  phase,
  today,
  units,
  nudge,
}: {
  phase: GoalPhase | null;
  today: string;
  units: UnitSystem;
  nudge: string | null;
}) {
  if (!phase) return null;

  const progress = phaseProgress(phase, today);
  const weeksLeft = Math.ceil(progress.daysRemaining / 7);
  const rateLabel = phaseHasRate(phase.kind)
    ? formatWeightRate(
        phase.kind === "cut" ? -phase.weeklyRateKg : phase.weeklyRateKg,
        units,
      )
    : "maintain";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Target className="h-4 w-4 text-brand" />
          {PHASE_LABELS[phase.kind]}
        </h3>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          week {progress.weekOf} of {progress.totalWeeks} · {rateLabel} ·{" "}
          {weeksLeft} {weeksLeft === 1 ? "wk" : "wks"} left
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(progress.pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${PHASE_LABELS[phase.kind]} phase progress`}
      >
        <div
          className={cn("h-full rounded-full bg-brand transition-[width]")}
          style={{ width: `${Math.round(progress.pct * 100)}%` }}
        />
      </div>

      {nudge && (
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          💡 {nudge}
        </p>
      )}
    </div>
  );
}
