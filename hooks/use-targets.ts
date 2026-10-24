"use client";

import { useTier } from "@/hooks/use-ai-usage";
import { useLatestBodyFatPct } from "@/hooks/use-latest-body-fat";
import { FEATURES } from "@/lib/billing/tiers";
import { useCallback, useMemo } from "react";
import {
  type DateTargets,
  type TargetContext,
  targetsForDate,
  type WeekTargets,
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
  /** The Monday-first week containing today, planned for `profile` (the
   *  current one, or an unsaved edit of it) with the same context — the
   *  training-week editor and its live preview. */
  planWeek: (profile: PersonalInfo) => WeekTargets | null;
  /** The Monday-to-Sunday week containing the displayed day, each day its
   *  own `targetsForDate` result (a cycled training week plans every day
   *  differently) — the Today week strip. `null` while the date key is not
   *  a calendar date (before hydration). The one place a week of day
   *  targets is resolved, so a per-date session override plugs in here
   *  for the strip and the day view alike. */
  selectedWeek: WeekTargets | null;
};

/** The app's calorie/macro targets, all from `targetsForDate` with one tier
 *  decision and one body-fat estimate (`useLatestBodyFatPct`, the same
 *  derivation /report and the crons use), so today's and the selected
 *  day's numbers can't drift apart from each other or from /report and the
 *  emails. */
export function useTargets(
  profile: PersonalInfo,
  today: string,
  selectedDate: string,
): AppTargets {
  const { tier } = useTier();
  const phasesEnabled = tier !== null && FEATURES.canUseGoalPhases(tier);
  const bodyFatPct = useLatestBodyFatPct(profile);
  const ctx = useMemo<TargetContext>(
    () => ({ phasesEnabled, bodyFatPct }),
    [phasesEnabled, bodyFatPct],
  );

  const todayTargets = useMemo(
    () => targetsForDate(profile, today, ctx),
    [profile, today, ctx],
  );
  const dayTargets = useMemo(
    () =>
      selectedDate === today
        ? todayTargets
        : targetsForDate(profile, selectedDate, ctx),
    [profile, selectedDate, today, todayTargets, ctx],
  );
  const targetForPhases = useCallback(
    (phases: GoalPhase[]) =>
      targetsForDate({ ...profile, goalPhases: phases }, today, ctx)
        .targetCalories,
    [profile, today, ctx],
  );
  const targetCaloriesForDate = useCallback(
    (date: string) => targetsForDate(profile, date, ctx).targetCalories,
    [profile, ctx],
  );
  const planWeek = useCallback(
    (planned: PersonalInfo) => weekTargets(planned, today, ctx),
    [today, ctx],
  );
  const selectedWeek = useMemo(
    () => weekTargets(profile, selectedDate, ctx),
    [profile, selectedDate, ctx],
  );

  return {
    phasesEnabled,
    todayTargets,
    dayTargets,
    targetForPhases,
    targetCaloriesForDate,
    planWeek,
    selectedWeek,
  };
}
