import type { PersonalInfo } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { BOTTLE_ML, GLASS_ML, waterGoalMl } from "./hydration";

/** Only `weight` + `waterGoalMl` matter to the formula; the rest is
 *  filler so we can type a believable profile without listing every
 *  field at each call site. */
function profile(over: Partial<PersonalInfo>): PersonalInfo {
  return {
    gender: "female",
    age: 30,
    weight: 70,
    height: 168,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    units: "metric",
    ...over,
  };
}

describe("waterGoalMl", () => {
  it("derives ~35 ml/kg, rounded to the nearest 50 ml", () => {
    // 70 kg × 35 = 2450 → already a multiple of 50.
    expect(waterGoalMl(profile({ weight: 70 }))).toBe(2450);
    // 68 kg × 35 = 2380 → rounds to 2400.
    expect(waterGoalMl(profile({ weight: 68 }))).toBe(2400);
  });

  it("clamps to the [1500, 4000] range", () => {
    // 40 kg × 35 = 1400 → floored to 1500.
    expect(waterGoalMl(profile({ weight: 40 }))).toBe(1500);
    // 130 kg × 35 = 4550 → capped at 4000.
    expect(waterGoalMl(profile({ weight: 130 }))).toBe(4000);
  });

  it("uses a positive manual override verbatim, ignoring weight", () => {
    expect(waterGoalMl(profile({ weight: 70, waterGoalMl: 3000 }))).toBe(3000);
  });

  it("falls back to the weight-based default when the override is null/0", () => {
    expect(waterGoalMl(profile({ weight: 70, waterGoalMl: null }))).toBe(2450);
    expect(waterGoalMl(profile({ weight: 70, waterGoalMl: 0 }))).toBe(2450);
  });

  it("exposes glass and bottle increments", () => {
    expect(GLASS_ML).toBe(250);
    expect(BOTTLE_ML).toBe(500);
  });
});
