import { effectiveGoal } from "./goal-phases";
import { computeMacros } from "./macros";
import type { CalculatedValues, GoalPhase, PersonalInfo } from "./types";

/** The ONE resolver for a calendar day's calorie/macro target. Every surface
 *  that shows or sends a target (the app's day view + calculator, the AI
 *  planners, /report, the weekly-recap email, the auto-adapt cron) goes
 *  through here, so they can never disagree about the same day.
 *
 *  Pipeline: the goal phase covering `date` (when the caller has cleared the
 *  Pro gate) → that phase's goal/rate and optional TDEE override → the shared
 *  `computeMacros` engine, with the age clock pinned to local midnight of
 *  `date`. Pure: the date and the tier decision are inputs, never read from
 *  the environment, so it runs identically on web, server and native. */

/** What the caller has resolved about the user before asking for a target.
 *  Gating lives in callers (see goal-phases.ts): pass `phasesEnabled: true`
 *  only after the tier check (`FEATURES.canUseGoalPhases`). */
export type TargetContext = {
  phasesEnabled: boolean;
};

/** A day's resolved target: the engine output plus what produced it. */
export type DateTargets = CalculatedValues & {
  /** The local `YYYY-MM-DD` these targets are for. */
  date: string;
  /** The goal direction actually driving the target — the covering phase's
   *  when one applies, else the profile's linear goal. */
  goal: PersonalInfo["goal"];
  /** The goal phase driving the target, or `null` (linear goal). */
  phase: GoalPhase | null;
};

/** Local midnight (ms epoch) of a `YYYY-MM-DD` key, or `undefined` for a key
 *  that isn't a real calendar date (e.g. the empty key `useToday` returns
 *  before hydration) — `computeMacros` then falls back to the present.
 *  Component-based like `addDays`, so DST never shifts the day. */
function localMidnightMs(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(y, m - 1, d);
  // Reject roll-overs like 2026-02-31 → March 3.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d)
    return undefined;
  return dt.getTime();
}

/** Resolve the calorie/macro target for `date` (local `YYYY-MM-DD`). */
export function targetsForDate(
  profile: PersonalInfo,
  date: string,
  ctx: TargetContext,
): DateTargets {
  const effective = effectiveGoal(profile, date, {
    phasesEnabled: ctx.phasesEnabled,
  });
  const values = computeMacros(
    {
      ...profile,
      goal: effective.goal,
      weeklyRateKg: effective.weeklyRateKg,
    },
    localMidnightMs(date),
    // The covering phase's own maintenance override (Pro), if set, wins over
    // the global manualTdee; computeMacros ignores null / ≤ 0.
    effective.phase?.tdeeOverride ?? undefined,
  );
  return {
    ...values,
    date,
    goal: effective.goal,
    phase: effective.phase,
  };
}
