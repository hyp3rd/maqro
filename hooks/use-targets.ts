"use client";

import { useTier } from "@/hooks/use-ai-usage";
import { FEATURES } from "@/lib/billing/tiers";
import { useCallback, useMemo } from "react";
import {
  type DateTargets,
  type WeekTargets,
  targetsForDate,
  weekTargets,
} from "@maqro/core/targets";
import type { GoalPhase, PersonalInfo } from "@maqro/core/types";

export type AppTargets = {
  /** Whether goal phases drive targets (Pro, from the shared cached tier). */
  phasesEnabled: boolean;
  /** Today's targets — the Calculator, Progress and the phase planner. */
  todayTargets: DateTargets;
  /** The displayed day's targets — the day view and everything that plans
   *  or compares against that day (totals, AI auto-fill / refine /
   *  regenerate / suggest-day, recipe slot budgets, meal insights). */
  dayTargets: DateTargets;
  /** Today's calorie target for a hypothetical phase list, through the same
   *  resolver — the phase planner's "raises your target" guard. */
  targetForPhases: (phases: GoalPhase[]) => number;
  /** Any date's own calorie target, through the same resolver and tier
   *  decision — the weekly recap scores each day against it. */
  targetCaloriesForDate: (date: string) => number;
  /** The Monday-to-Sunday week containing the displayed day, each day its
   *  own `targetsForDate` result (a cycled training week plans every day
   *  differently) — the Today week strip. `null` while the date key is not
   *  a calendar date (before hydration). The one place a week of day
   *  targets is resolved, so a per-date session override plugs in here
   *  for the strip and the day view alike. */
  selectedWeek: WeekTargets | null;
};

/** The app's calorie/macro targets, all from `targetsForDate` with one tier
 *  decision, so today's and the selected day's numbers can't drift apart
 *  from each other or from /report and the emails. */
export function useTargets(
  profile: PersonalInfo,
  today: string,
  selectedDate: string,
): AppTargets {
  const { tier } = useTier();
  const phasesEnabled = tier !== null && FEATURES.canUseGoalPhases(tier);

  const todayTargets = useMemo(
    () => targetsForDate(profile, today, { phasesEnabled }),
    [profile, today, phasesEnabled],
  );
  const dayTargets = useMemo(
    () =>
      selectedDate === today
        ? todayTargets
        : targetsForDate(profile, selectedDate, { phasesEnabled }),
    [profile, selectedDate, today, todayTargets, phasesEnabled],
  );
  const targetForPhases = useCallback(
    (phases: GoalPhase[]) =>
      targetsForDate({ ...profile, goalPhases: phases }, today, {
        phasesEnabled,
      }).targetCalories,
    [profile, today, phasesEnabled],
  );
  const targetCaloriesForDate = useCallback(
    (date: string) =>
      targetsForDate(profile, date, { phasesEnabled }).targetCalories,
    [profile, phasesEnabled],
  );

  const selectedWeek = useMemo(
    () => weekTargets(profile, selectedDate, { phasesEnabled }),
    [profile, selectedDate, phasesEnabled],
  );

  return {
    phasesEnabled,
    todayTargets,
    dayTargets,
    targetForPhases,
    targetCaloriesForDate,
    selectedWeek,
  };
}
