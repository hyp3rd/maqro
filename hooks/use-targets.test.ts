/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayOverrideResolver,
  targetsForDate,
  weekTargets,
} from "@maqro/core/targets";
import type { PersonalInfo, TrainingSchedule } from "@maqro/core/types";
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
const bodyFat = vi.hoisted(() => ({ pct: null as number | null }));
vi.mock("@/hooks/use-latest-body-fat", () => ({
  useLatestBodyFatPct: () => bodyFat.pct,
}));
const stored = vi.hoisted(() => ({
  overrides: [] as { date: string; day: unknown; recordedAt: number }[],
  loaded: true,
}));
vi.mock("@/hooks/use-day-overrides", () => ({
  useDayOverrides: () => ({
    overrides: stored.overrides,
    loaded: stored.loaded,
    setOverride: vi.fn(),
    clearOverride: vi.fn(),
  }),
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
  bodyFat.pct = null;
  stored.overrides = [];
  stored.loaded = true;
});

describe("useTargets", () => {
  it("says whether the per-date overrides have loaded (the AI entry points wait for it)", () => {
    stored.loaded = false;
    const { result, rerender } = renderHook(() =>
      useTargets(PROFILE, TODAY, TODAY),
    );
    // Until then an overridden date would read as its template day.
    expect(result.current.overridesLoaded).toBe(false);
    stored.loaded = true;
    rerender();
    expect(result.current.overridesLoaded).toBe(true);
  });

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

/** Every target the app resolves reads the SAME body-fat estimate the
 *  report and the crons use (`useLatestBodyFatPct` → `latestBodyFatPct`):
 *  a lean-mass protein setting is the visible difference. */
describe("useTargets — body fat", () => {
  const SCHEDULE: TrainingSchedule = {
    enabled: true,
    cycling: "modest",
    days: [
      { type: "rest" },
      { type: "upper", intensity: "moderate" },
      { type: "rest" },
      { type: "lower", intensity: "hard" },
      { type: "rest" },
      { type: "fullBody", intensity: "moderate" },
      { type: "rest" },
    ],
  };
  const TRAINING: PersonalInfo = {
    ...PROFILE,
    goalPhases: [],
    training: SCHEDULE,
    proteinSetting: { basis: "leanMass", gPerKg: 2.6 },
  };
  const ctx = (bodyFatPct: number | null) => ({
    phasesEnabled: true,
    bodyFatPct,
  });

  it("passes the latest estimate to today's, the shown day's and any day's target", () => {
    bodyFat.pct = 20;
    const { result } = renderHook(() =>
      useTargets(TRAINING, TODAY, BEFORE_CUT),
    );
    const today = targetsForDate(TRAINING, TODAY, ctx(20));
    // 2.6 g/kg × 64 kg lean mass, not the 2.0 g/kg bodyweight fallback.
    expect(today.protein).not.toBe(
      targetsForDate(TRAINING, TODAY, ctx(null)).protein,
    );
    expect(result.current.todayTargets).toEqual(today);
    expect(result.current.dayTargets).toEqual(
      targetsForDate(TRAINING, BEFORE_CUT, ctx(20)),
    );
    expect(result.current.targetCaloriesForDate(BEFORE_CUT)).toBe(
      targetsForDate(TRAINING, BEFORE_CUT, ctx(20)).targetCalories,
    );
  });

  it("planWeek plans this week through the same resolver and context", () => {
    bodyFat.pct = 20;
    const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
    expect(result.current.planWeek(TRAINING)).toEqual(
      weekTargets(TRAINING, TODAY, ctx(20)),
    );
    // A hypothetical edit (the editor's preview) uses the same context.
    const off: PersonalInfo = {
      ...TRAINING,
      training: { ...SCHEDULE, cycling: "off" },
    };
    expect(result.current.planWeek(off)).toEqual(
      weekTargets(off, TODAY, ctx(20)),
    );
  });

  it("without an estimate the targets are the plain resolver's", () => {
    bodyFat.pct = null;
    const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
    expect(result.current.todayTargets).toEqual(
      targetsForDate(TRAINING, TODAY, ctx(null)),
    );
  });

  it("selectedWeek reads the same estimate as the day view and planWeek", () => {
    bodyFat.pct = 20;
    const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
    expect(result.current.selectedWeek).toEqual(
      weekTargets(TRAINING, TODAY, ctx(20)),
    );
    expect(result.current.selectedWeek).toEqual(
      result.current.planWeek(TRAINING),
    );
    expect(
      result.current.selectedWeek?.days.find((d) => d.date === TODAY),
    ).toEqual(result.current.dayTargets);
  });

  describe("per-date session overrides", () => {
    // TODAY (Wed 2026-06-10) is planned as a hard lower-body day.
    const REST_TODAY = { date: TODAY, day: { type: "rest" }, recordedAt: 1 };
    const withOverride = {
      ...ctx(null),
      overrideFor: dayOverrideResolver([REST_TODAY]),
    };

    it("today's, the shown day's and any day's target follow the stored override", () => {
      stored.overrides = [REST_TODAY];
      const plain = targetsForDate(TRAINING, TODAY, ctx(null));
      const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));

      expect(result.current.todayTargets).toEqual(
        targetsForDate(TRAINING, TODAY, withOverride),
      );
      expect(result.current.todayTargets.training?.overridden).toBe(true);
      expect(result.current.todayTargets.targetCalories).toBeLessThan(
        plain.targetCalories,
      );
      expect(result.current.dayTargets).toBe(result.current.todayTargets);
      expect(result.current.targetCaloriesForDate(TODAY)).toBe(
        result.current.todayTargets.targetCalories,
      );
    });

    it("planWeek plans the TEMPLATE week, without overrides (the editor)", () => {
      stored.overrides = [REST_TODAY];
      const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
      expect(result.current.planWeek(TRAINING)).toEqual(
        weekTargets(TRAINING, TODAY, ctx(null)),
      );
    });

    it("previewDayTargets resolves a candidate session, or the plan for null", () => {
      stored.overrides = [REST_TODAY];
      const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
      const legs = { type: "lower" as const, intensity: "hard" as const };
      expect(result.current.previewDayTargets(BEFORE_CUT, legs)).toEqual(
        targetsForDate(TRAINING, BEFORE_CUT, {
          ...ctx(null),
          overrideFor: dayOverrideResolver([
            REST_TODAY,
            { date: BEFORE_CUT, day: legs },
          ]),
        }),
      );
      // Back to plan: the template day even though an override is stored.
      expect(result.current.previewDayTargets(TODAY, null)).toEqual(
        targetsForDate(TRAINING, TODAY, ctx(null)),
      );
    });

    it("selectedWeek carries the override on its day only, matching the day view", () => {
      stored.overrides = [REST_TODAY];
      const { result } = renderHook(() => useTargets(TRAINING, TODAY, TODAY));
      const week = result.current.selectedWeek;
      expect(week).toEqual(weekTargets(TRAINING, TODAY, withOverride));
      expect(week?.days.find((d) => d.date === TODAY)).toEqual(
        result.current.dayTargets,
      );
      // Only the overridden day moves; the template week (planWeek) keeps
      // every other day's target.
      const template = result.current.planWeek(TRAINING);
      week?.days.forEach((d, i) => {
        const planned = template?.days[i]?.targetCalories;
        if (d.date === TODAY)
          expect(d.targetCalories).toBeLessThan(planned ?? 0);
        else expect(d.targetCalories).toBe(planned);
      });
    });
  });
});
