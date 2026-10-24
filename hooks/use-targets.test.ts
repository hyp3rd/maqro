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

  it("targetCaloriesForDate resolves any day's own target (the recap)", () => {
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(result.current.targetCaloriesForDate(TODAY)).toBe(1900);
    expect(result.current.targetCaloriesForDate(BEFORE_CUT)).toBe(2600);
    tierState.tier = "free";
    const free = renderHook(() => useTargets(PROFILE, TODAY, TODAY));
    expect(free.result.current.targetCaloriesForDate(TODAY)).toBe(2600);
  });
});

/** The Today week strip: the Monday-to-Sunday week of the displayed day,
 *  every day through the same resolver (and tier decision) as `dayTargets`,
 *  so a cycled training week shows each day's OWN planned target. */
describe("useTargets selectedWeek", () => {
  const TRAINING: PersonalInfo = {
    ...PROFILE,
    training: {
      enabled: true,
      cycling: "modest",
      days: [
        { type: "rest" },
        { type: "upper", intensity: "moderate" },
        { type: "rest" },
        { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
        { type: "rest" },
        { type: "fullBody", intensity: "moderate" },
        { type: "endurance", durationMin: 90 },
      ],
    },
  };

  it("is the Monday-first week of the selected day, each day its own target", () => {
    const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
    const week = result.current.selectedWeek;
    expect(week?.weekStart).toBe("2026-06-08");
    expect(week?.days.map((d) => d.date)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    // The selected day's entry is exactly the day view's target.
    expect(week?.days[2]).toEqual(result.current.dayTargets);
    // Cycled: Wednesday's hard lower day > Monday's upper day > Tuesday's
    // rest day, and the planned days still sum to seven weekly-mean days
    // (no banking, no top-up).
    const kcal = week?.days.map((d) => d.targetCalories) ?? [];
    expect(kcal[2]).toBeGreaterThan(kcal[0] ?? Infinity);
    expect(kcal[0]).toBeGreaterThan(kcal[1] ?? Infinity);
    expect(week?.totalCalories).toBe(7 * 1900);
    expect(week?.days[3]?.training?.dayClass).toBe("rest");
  });

  it("follows a past selected day into its own week and tier decision", () => {
    tierState.tier = "free";
    const { result } = renderHook(() =>
      useTargets(TRAINING, TODAY, BEFORE_CUT),
    );
    const week = result.current.selectedWeek;
    expect(week?.weekStart).toBe("2026-05-25");
    expect(week?.days.find((d) => d.date === BEFORE_CUT)).toEqual(
      result.current.dayTargets,
    );
    expect(week?.totalCalories).toBe(7 * 2600);
  });

  it("is null before the date is known (pre-hydration empty key)", () => {
    const { result } = renderHook(() => useTargets(TRAINING, "", ""));
    expect(result.current.selectedWeek).toBeNull();
  });
});
