/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import { renderHook } from "@testing-library/react";
import { useTargets } from "./use-targets";

/** The app's day view must compare (and AI-plan) a displayed day against
 *  THAT day's target, while the Calculator / Progress keep today's. */

const tierState = vi.hoisted(() => ({
  tier: "pro" as "free" | "plus" | "pro" | null,
  resolved: true,
}));
vi.mock("@/hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: tierState.tier, resolved: tierState.resolved }),
}));

const TODAY = "2026-06-10";
const BEFORE_CUT = "2026-05-28";

/** Linear goal: maintain at 2600. A cut (−550/day, own maintenance 2450)
 *  covers [2026-06-01, 2026-06-29): today is inside it, BEFORE_CUT isn't. */
const PROFILE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  manualTdee: 2600,
  units: "metric",
  goalPhases: [
    {
      id: "ph_cut",
      kind: "cut",
      startDate: "2026-06-01",
      durationWeeks: 4,
      weeklyRateKg: 0.5,
      tdeeOverride: 2450,
    },
  ],
};

beforeEach(() => {
  tierState.tier = "pro";
  tierState.resolved = true;
});

describe("useTargets", () => {
  it("a past day uses its own target, today keeps today's", () => {
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, BEFORE_CUT));
    expect(result.current.todayTargets.date).toBe(TODAY);
    expect(result.current.todayTargets.targetCalories).toBe(1900);
    expect(result.current.todayTargets.goal).toBe("lose");
    // The selected (past) day predates the cut → the linear goal.
    expect(result.current.dayTargets.date).toBe(BEFORE_CUT);
    expect(result.current.dayTargets.targetCalories).toBe(2600);
    expect(result.current.dayTargets.phase).toBeNull();
  });

  it("viewing today, the day view and today share one target", () => {
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(result.current.dayTargets).toBe(result.current.todayTargets);
    expect(result.current.dayTargets.targetCalories).toBe(1900);
  });

  it("phases are off without Pro (free tier or unknown tier)", () => {
    tierState.tier = "free";
    const free = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(free.result.current.phasesEnabled).toBe(false);
    expect(free.result.current.todayTargets.targetCalories).toBe(2600);

    tierState.tier = null;
    tierState.resolved = false;
    const unknown = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(unknown.result.current.todayTargets.targetCalories).toBe(2600);
  });

  it("targetForPhases runs the same resolver for a hypothetical plan", () => {
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(result.current.targetForPhases([])).toBe(2600);
    expect(result.current.targetForPhases(PROFILE.goalPhases ?? [])).toBe(1900);
  });
});
