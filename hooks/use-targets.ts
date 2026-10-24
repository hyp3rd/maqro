"use client";

import { useTier } from "@/hooks/use-ai-usage";
import { useDayOverrides } from "@/hooks/use-day-overrides";
import { useLatestBodyFatPct } from "@/hooks/use-latest-body-fat";
import { FEATURES } from "@/lib/billing/tiers";
import { useCallback, useMemo } from "react";
import {
  type DateTargets,
  type TargetContext,
  dayOverrideResolver,
  targetsForDate,
  type WeekTargets,
  weekTargets,
} from "@maqro/core/targets";
import type { GoalPhase, PersonalInfo, TrainingDay } from "@maqro/core/types";

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
  /** The Monday-first TEMPLATE week containing today, planned for `profile`
   *  (the current one, or an unsaved edit of it) with the same tier and
   *  body-fat context but no per-date overrides — the training-week editor
   *  and its live preview edit the template, not one week's exceptions. */
  planWeek: (profile: PersonalInfo) => WeekTargets | null;
  /** `date`'s targets if its session were `day` (`null` = back to plan, the
   *  template day), with every other stored override and the same context —
   *  the day-type sheet's live preview. */
  previewDayTargets: (date: string, day: TrainingDay | null) => DateTargets;
};

/** The app's calorie/macro targets, all from `targetsForDate` with one tier
 *  decision, one body-fat estimate (`useLatestBodyFatPct`, the same
 *  derivation /report and the crons use) and this device's per-date session
 *  overrides (`useDayOverrides`, the rows /report and the weekly email read
 *  too), so today's and the selected day's numbers can't drift apart from
 *  each other or from /report and the emails. */
export function useTargets(
  profile: PersonalInfo,
  today: string,
  selectedDate: string,
): AppTargets {
  const { tier } = useTier();
  const phasesEnabled = tier !== null && FEATURES.canUseGoalPhases(tier);
  const bodyFatPct = useLatestBodyFatPct(profile);
  const { overrides } = useDayOverrides();
  const templateCtx = useMemo<TargetContext>(
    () => ({ phasesEnabled, bodyFatPct }),
    [phasesEnabled, bodyFatPct],
  );
  const ctx = useMemo<TargetContext>(
    () => ({ ...templateCtx, overrideFor: dayOverrideResolver(overrides) }),
    [templateCtx, overrides],
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
    (planned: PersonalInfo) => weekTargets(planned, today, templateCtx),
    [today, templateCtx],
  );
  const previewDayTargets = useCallback(
    (date: string, day: TrainingDay | null) =>
      targetsForDate(profile, date, {
        ...templateCtx,
        overrideFor: (d) => (d === date ? day : ctx.overrideFor?.(d)),
      }),
    [profile, templateCtx, ctx],
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
    previewDayTargets,
  };
}
