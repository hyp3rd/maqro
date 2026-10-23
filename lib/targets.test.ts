import type { GoalPhase, PersonalInfo } from "@maqro/core/types";
import { computeMacros } from "@maqro/core/macros";
import { targetsForDate } from "@maqro/core/targets";
import { describe, expect, it } from "vitest";

/** 80 kg / 180 cm / 30 y male on a linear "maintain" goal with a calibrated
 *  2600 kcal maintenance. BMR = 1780, so the safety floor (max(BMR, 1200))
 *  never interferes with the 550 kcal/day cut used below. */
function profile(over: Partial<PersonalInfo> = {}): PersonalInfo {
  return {
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
    ...over,
  };
}

/** A 4-week cut at 0.5 kg/week (−550 kcal/day) covering
 *  [2026-06-01, 2026-06-29). */
function cut(over: Partial<GoalPhase> = {}): GoalPhase {
  return {
    id: "ph_cut",
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.5,
    ...over,
  };
}

const PRO = { phasesEnabled: true };
const FREE = { phasesEnabled: false };

describe("targetsForDate", () => {
  type Row = {
    name: string;
    profile: PersonalInfo;
    date: string;
    ctx: { phasesEnabled: boolean };
    kcal: number;
    tdee: number;
    goal: PersonalInfo["goal"];
    phaseId: string | null;
  };
  const rows: Row[] = [
    {
      name: "no phases → the linear goal",
      profile: profile(),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "active cut without tdeeOverride → global manualTdee − 550",
      profile: profile({ goalPhases: [cut()] }),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 2050,
      tdee: 2600,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "active cut with tdeeOverride → the phase's maintenance − 550",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "phase start date is inclusive",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-01",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "the day before the phase → linear",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-05-31",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "last day of the phase window → still the cut",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-28",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "phase end date is exclusive → linear",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-29",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "phasesEnabled false (not Pro) ignores a covering phase",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-10",
      ctx: FREE,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "a diet break sits at maintenance (rate forced to 0)",
      profile: profile({
        goalPhases: [
          cut(),
          {
            id: "ph_break",
            kind: "dietBreak",
            startDate: "2026-06-29",
            durationWeeks: 2,
            weeklyRateKg: 0.5,
          },
        ],
      }),
      date: "2026-07-01",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: "ph_break",
    },
    {
      name: "a past date resolves that date's phase, not today's",
      profile: profile({
        goal: "gain",
        weeklyRateKg: 0.25,
        goalPhases: [cut({ startDate: "2025-01-06", tdeeOverride: 2450 })],
      }),
      date: "2025-01-20",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "a future date resolves a phase that hasn't started yet",
      profile: profile({
        goalPhases: [cut({ startDate: "2027-03-01", tdeeOverride: 2450 })],
      }),
      date: "2027-03-02",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const t = targetsForDate(row.profile, row.date, row.ctx);
      expect(t.date).toBe(row.date);
      expect(t.targetCalories).toBe(row.kcal);
      expect(t.tdee).toBe(row.tdee);
      expect(t.goal).toBe(row.goal);
      expect(t.phase?.id ?? null).toBe(row.phaseId);
    });
  }

  it("is bit-identical to computeMacros for the linear goal (no phase)", () => {
    const p = profile({ manualTdee: null, goal: "lose", weeklyRateKg: 0.4 });
    const date = "2026-06-10";
    expect(targetsForDate(p, date, FREE)).toEqual({
      ...computeMacros(p, new Date(2026, 5, 10).getTime(), undefined),
      date,
      goal: "lose",
      phase: null,
    });
  });

  it("macros follow the phase-driven calories (cut ratios)", () => {
    const t = targetsForDate(
      profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      "2026-06-10",
      PRO,
    );
    // lose split 40/25/35 of 1900 kcal
    expect(t.protein).toBe(190);
    expect(t.carbs).toBe(119);
    expect(t.fat).toBe(74);
  });

  it("pins the age clock to the target date (a birthday rolls the BMR)", () => {
    // Formula TDEE (no manualTdee) so the BMR change reaches the target.
    const p = profile({ manualTdee: null, birthDate: "1996-06-15" });
    const before = targetsForDate(p, "2026-06-14", FREE); // 29
    const on = targetsForDate(p, "2026-06-15", FREE); // 30
    expect(before.bmr - on.bmr).toBe(5);
    expect(before.targetCalories).toBeGreaterThan(on.targetCalories);
  });

  it("falls back to the present clock for a non-date key", () => {
    const p = profile();
    const t = targetsForDate(p, "", PRO);
    expect(t.targetCalories).toBe(2600);
    expect(t.phase).toBeNull();
  });
});
