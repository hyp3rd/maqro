import { addDays } from "./date";
import type { GoalPhase, GoalPhaseKind, PersonalInfo } from "./types";

/** Pure goal-phase logic. A phase plan lets a user sequence a cut → diet
 *  break → maintenance → lean bulk; the phase active on today's date drives
 *  the calorie/macro target (via `effectiveGoal`, fed into `computeMacros`).
 *  No React, no IDB — trivially testable. Dates are local `YYYY-MM-DD`; the
 *  Pro gating lives in the callers, not here. */

export const PHASE_KINDS: readonly GoalPhaseKind[] = [
  "cut",
  "dietBreak",
  "maintenance",
  "leanBulk",
];

export const PHASE_LABELS: Record<GoalPhaseKind, string> = {
  cut: "Cut",
  dietBreak: "Diet break",
  maintenance: "Maintenance",
  leanBulk: "Lean bulk",
};

const MIN_WEEKS = 1;
const MAX_WEEKS = 52;
/** Suggest a diet break once a cut has run at least this long. */
const DIET_BREAK_AFTER_WEEKS = 10;
const DAY_MS = 86_400_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Whole local-calendar days from `a` to `b` (`b - a`). DST-safe (rounds). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ams = new Date(ay, am - 1, ad).getTime();
  const bms = new Date(by, bm - 1, bd).getTime();
  return Math.round((bms - ams) / DAY_MS);
}

/** The `computeMacros` goal direction a phase kind maps to. */
export function phaseGoal(kind: GoalPhaseKind): PersonalInfo["goal"] {
  if (kind === "cut") return "lose";
  if (kind === "leanBulk") return "gain";
  return "maintain"; // maintenance + dietBreak both sit at maintenance
}

/** Whether a kind uses a non-zero weekly rate (only cut / lean bulk do). */
export function phaseHasRate(kind: GoalPhaseKind): boolean {
  return kind === "cut" || kind === "leanBulk";
}

/** The day the phase's window ends (exclusive). */
export function phaseEndDate(phase: GoalPhase): string {
  return addDays(phase.startDate, phase.durationWeeks * 7);
}

/** Phases ordered by start date (oldest first). */
export function sortPhases(phases: GoalPhase[]): GoalPhase[] {
  return [...phases].sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0,
  );
}

/** The phase whose `[startDate, end)` window contains `today`; on overlap the
 *  latest-starting one wins. `null` when none cover today. */
export function activePhase(
  phases: GoalPhase[] | undefined,
  today: string,
): GoalPhase | null {
  if (!phases) return null;
  let best: GoalPhase | null = null;
  for (const phase of phases) {
    if (phase.startDate <= today && today < phaseEndDate(phase)) {
      if (best === null || phase.startDate > best.startDate) best = phase;
    }
  }
  return best;
}

/** The soonest phase that starts strictly after `today`. */
export function nextPhase(
  phases: GoalPhase[] | undefined,
  today: string,
): GoalPhase | null {
  if (!phases) return null;
  let best: GoalPhase | null = null;
  for (const phase of phases) {
    if (phase.startDate > today) {
      if (best === null || phase.startDate < best.startDate) best = phase;
    }
  }
  return best;
}

export type EffectiveGoal = {
  goal: PersonalInfo["goal"];
  weeklyRateKg: number;
  /** The phase that's driving the target, or `null` (linear fallback). */
  phase: GoalPhase | null;
};

/** The `{goal, weeklyRateKg}` to feed `computeMacros`: the active phase's when
 *  phases are enabled (Pro) AND one covers today; otherwise the profile's
 *  linear goal. The single helper the target memo calls. */
export function effectiveGoal(
  profile: PersonalInfo,
  today: string,
  opts: { phasesEnabled: boolean },
): EffectiveGoal {
  if (opts.phasesEnabled) {
    const phase = activePhase(profile.goalPhases, today);
    if (phase) {
      return {
        goal: phaseGoal(phase.kind),
        weeklyRateKg: phaseHasRate(phase.kind) ? phase.weeklyRateKg : 0,
        phase,
      };
    }
  }
  return {
    goal: profile.goal,
    weeklyRateKg: profile.weeklyRateKg,
    phase: null,
  };
}

export type PhaseProgress = {
  /** 1-based current week within the phase. */
  weekOf: number;
  totalWeeks: number;
  daysElapsed: number;
  daysRemaining: number;
  /** 0–1 through the phase. */
  pct: number;
};

/** How far `today` is through `phase` (clamped to the phase window). */
export function phaseProgress(phase: GoalPhase, today: string): PhaseProgress {
  const totalDays = phase.durationWeeks * 7;
  const elapsed = clamp(daysBetween(phase.startDate, today), 0, totalDays);
  return {
    weekOf: Math.min(phase.durationWeeks, Math.floor(elapsed / 7) + 1),
    totalWeeks: phase.durationWeeks,
    daysElapsed: elapsed,
    daysRemaining: Math.max(0, totalDays - elapsed),
    pct: totalDays > 0 ? elapsed / totalDays : 0,
  };
}

/** A gentle suggestion text when the active phase is a cut that's run long,
 *  else `null`. (Surfaced on the dashboard banner.) */
export function dietBreakNudge(
  phases: GoalPhase[] | undefined,
  today: string,
): string | null {
  const phase = activePhase(phases, today);
  if (!phase || phase.kind !== "cut") return null;
  const weeksIn = Math.floor(daysBetween(phase.startDate, today) / 7);
  if (weeksIn < DIET_BREAK_AFTER_WEEKS) return null;
  return `You've been cutting ${weeksIn} weeks. A 1–2 week diet break at maintenance can ease fatigue and protect adherence before you resume.`;
}

/** Clamp a phase's editable fields to safe bounds — duration 1–52 weeks, rate
 *  0…1% bodyweight/week, and rate forced to 0 for non-cut/bulk kinds. */
export function normalizePhase(phase: GoalPhase, weightKg: number): GoalPhase {
  return {
    ...phase,
    durationWeeks: clamp(Math.round(phase.durationWeeks), MIN_WEEKS, MAX_WEEKS),
    weeklyRateKg: phaseHasRate(phase.kind)
      ? clamp(phase.weeklyRateKg, 0, weightKg * 0.01)
      : 0,
  };
}

function mkId(): string {
  // Platform-agnostic — @maqro/core ships to React Native, which has no global
  // `crypto.randomUUID` (and no Node crypto). A timestamp + random suffix is
  // unique enough for these local goal-phase records: they're opaque keys, not
  // security tokens, and phases persist inside the single PersonalInfo blob
  // (synced as a whole), so cross-device id collisions aren't a concern.
  return `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Default rates as a fraction of bodyweight/week — conservative, under the
// 1% cap: a ~0.66%/wk cut and a slower ~0.33%/wk lean bulk.
const CUT_RATE_FRAC = 0.0066;
const BULK_RATE_FRAC = 0.0033;

/** Preset: a single 12-week cut starting today. */
export function presetCut(today: string, weightKg: number): GoalPhase[] {
  return [
    normalizePhase(
      {
        id: mkId(),
        kind: "cut",
        startDate: today,
        durationWeeks: 12,
        weeklyRateKg: weightKg * CUT_RATE_FRAC,
      },
      weightKg,
    ),
  ];
}

/** Preset: a 12-week cut, then a 2-week diet break at maintenance. */
export function presetCutThenBreak(
  today: string,
  weightKg: number,
): GoalPhase[] {
  const cut = normalizePhase(
    {
      id: mkId(),
      kind: "cut",
      startDate: today,
      durationWeeks: 12,
      weeklyRateKg: weightKg * CUT_RATE_FRAC,
    },
    weightKg,
  );
  const brk = normalizePhase(
    {
      id: mkId(),
      kind: "dietBreak",
      startDate: phaseEndDate(cut),
      durationWeeks: 2,
      weeklyRateKg: 0,
    },
    weightKg,
  );
  return [cut, brk];
}

/** Preset: a single 12-week lean bulk starting today. */
export function presetLeanBulk(today: string, weightKg: number): GoalPhase[] {
  return [
    normalizePhase(
      {
        id: mkId(),
        kind: "leanBulk",
        startDate: today,
        durationWeeks: 12,
        weeklyRateKg: weightKg * BULK_RATE_FRAC,
      },
      weightKg,
    ),
  ];
}

/** Mint a blank phase for the "Add phase" editor (starts after the last
 *  phase, or today). */
export function newPhase(phases: GoalPhase[], today: string): GoalPhase {
  const sorted = sortPhases(phases);
  const last = sorted[sorted.length - 1];
  const start = last ? phaseEndDate(last) : today;
  return {
    id: mkId(),
    kind: "cut",
    startDate: start < today ? today : start,
    durationWeeks: 8,
    weeklyRateKg: 0,
  };
}
