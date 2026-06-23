import type { PersonalInfo } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { computeMacros } from "./macros";

const baseline: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 70,
  height: 175,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  units: "metric",
};

describe("computeMacros", () => {
  it("matches the canonical Mifflin-St Jeor example", () => {
    // Male 30yo 70kg 175cm moderate (1.55), maintain.
    // BMR = 10*70 + 6.25*175 - 5*30 + 5 = 1648.75
    // TDEE = BMR × 1.55 = 2555.5
    const r = computeMacros(baseline);
    expect(r.bmr).toBe(1649);
    expect(r.tdee).toBe(2556);
    expect(r.targetCalories).toBe(r.tdee); // maintain → no offset
    expect(r.dailyDelta).toBe(0);
  });

  it("applies the kg/week deficit symmetrically", () => {
    const lose = computeMacros({
      ...baseline,
      goal: "lose",
      weeklyRateKg: 0.5,
    });
    // 0.5 kg/week × 7700 / 7 ≈ -550 kcal/day
    expect(lose.dailyDelta).toBeLessThan(-540);
    expect(lose.dailyDelta).toBeGreaterThan(-560);

    const gain = computeMacros({
      ...baseline,
      goal: "gain",
      weeklyRateKg: 0.5,
    });
    expect(gain.dailyDelta).toBeGreaterThan(540);
    expect(gain.dailyDelta).toBeLessThan(560);
  });

  it("caps the rate at 1% of bodyweight per week", () => {
    // 70kg user requests 2 kg/week - should clamp to 0.7 kg/week.
    const r = computeMacros({ ...baseline, goal: "lose", weeklyRateKg: 2 });
    // 0.7 × 7700 / 7 = 770
    expect(r.dailyDelta).toBeGreaterThan(-790);
    expect(r.dailyDelta).toBeLessThan(-750);
  });

  it("floors calories at max(BMR, 1200)", () => {
    // Tiny user, aggressive deficit → would drop below BMR without floor.
    const r = computeMacros({
      ...baseline,
      weight: 45, // BMR ≈ 1304
      goal: "lose",
      weeklyRateKg: 0.45, // cap is 0.45 kg/week
    });
    // requested ≈ -495; raw target = TDEE(~2020) - 495 = 1525 - still above BMR.
    expect(r.targetCalories).toBeGreaterThanOrEqual(r.bmr);
    expect(r.targetCalories).toBeGreaterThanOrEqual(1200);

    // Extreme case: large deficit + small TDEE.
    const aggressive = computeMacros({
      ...baseline,
      weight: 45,
      activityLevel: "sedentary",
      goal: "lose",
      weeklyRateKg: 0.45,
    });
    expect(aggressive.targetCalories).toBe(Math.max(aggressive.bmr, 1200));
    // dailyDelta in this case is post-floor (what actually happens),
    // requestedDelta is what was asked for before floor.
    expect(aggressive.dailyDelta).not.toBe(aggressive.requestedDelta);
  });

  it("derives per-macro targets that sum (approximately) to total kcal", () => {
    const r = computeMacros({ ...baseline, goal: "lose", weeklyRateKg: 0.5 });
    const kcal = r.protein * 4 + r.carbs * 4 + r.fat * 9;
    // Rounding error within ±10 kcal per macro is expected.
    expect(Math.abs(kcal - r.targetCalories)).toBeLessThan(30);
  });

  it("shifts the macro split based on goal", () => {
    const lose = computeMacros({
      ...baseline,
      goal: "lose",
      weeklyRateKg: 0.5,
    });
    // Lose → 40% protein, higher than maintain's 30%.
    const proteinFraction = (lose.protein * 4) / lose.targetCalories;
    expect(proteinFraction).toBeGreaterThan(0.35);

    const gain = computeMacros({
      ...baseline,
      goal: "gain",
      weeklyRateKg: 0.5,
    });
    // Gain → 45% carbs.
    const carbFraction = (gain.carbs * 4) / gain.targetCalories;
    expect(carbFraction).toBeGreaterThan(0.4);
  });

  it("handles female BMR offset", () => {
    const r = computeMacros({ ...baseline, gender: "female" });
    // Male BMR was 1649, female differs by -166 (male: +5 vs female: -161).
    expect(r.bmr).toBe(1483);
  });

  it("uses the pessimistic (female) formula for non-binary / prefer-not-to-say", () => {
    const female = computeMacros({ ...baseline, gender: "female" });
    const nb = computeMacros({ ...baseline, gender: "nonbinary" });
    const undisclosed = computeMacros({
      ...baseline,
      gender: "preferNotToSay",
    });
    // All three non-male options must match: same BMR → same TDEE → same
    // targets. Lower-estimate path keeps calorie targets conservative.
    expect(nb.bmr).toBe(female.bmr);
    expect(undisclosed.bmr).toBe(female.bmr);
    expect(nb.targetCalories).toBe(female.targetCalories);
  });

  it("uses manualTdee when provided (overrides BMR × activity)", () => {
    const formula = computeMacros({
      ...baseline,
      activityLevel: "active",
      goal: "lose",
      weeklyRateKg: 0.5,
    });
    // Same inputs but pinning TDEE 400 below the formula estimate.
    const overridden = computeMacros({
      ...baseline,
      activityLevel: "active",
      goal: "lose",
      weeklyRateKg: 0.5,
      manualTdee: formula.tdee - 400,
    });
    expect(overridden.tdee).toBe(formula.tdee - 400);
    // Deficit is preserved; target shifts down by the same 400.
    expect(overridden.targetCalories).toBe(formula.targetCalories - 400);
    expect(overridden.dailyDelta).toBe(formula.dailyDelta);
  });

  it("ignores manualTdee when null, undefined, zero, or negative", () => {
    const expected = computeMacros(baseline).tdee;
    for (const v of [null, undefined, 0, -100]) {
      const r = computeMacros({ ...baseline, manualTdee: v });
      expect(r.tdee).toBe(expected);
    }
  });

  it("respects the safety floor when manualTdee + deficit drops too low", () => {
    const r = computeMacros({
      ...baseline,
      goal: "lose",
      weeklyRateKg: 0.5,
      manualTdee: 1500,
    });
    // Floor is max(bmr, 1200) ≈ 1649 (baseline male 30/175/70). With manual
    // TDEE 1500 the BMR floor is *higher* than TDEE; target snaps to BMR.
    expect(r.targetCalories).toBe(r.bmr);
  });

  it("uses the per-phase tdeeOverride over both manualTdee and the formula", () => {
    // Override wins even when a (different) global manualTdee is also set.
    const r = computeMacros({ ...baseline, manualTdee: 2000 }, undefined, 3000);
    expect(r.tdee).toBe(3000);
    expect(r.targetCalories).toBe(3000); // maintain → no offset
  });

  it("ignores tdeeOverride when null/undefined/≤0 (falls back to manualTdee)", () => {
    for (const v of [null, undefined, 0, -100]) {
      const r = computeMacros({ ...baseline, manualTdee: 2000 }, undefined, v);
      expect(r.tdee).toBe(2000);
    }
  });

  it("still applies the safety floor to a low tdeeOverride", () => {
    const r = computeMacros({ ...baseline, goal: "maintain" }, undefined, 500);
    // Override sets TDEE to 500, but the target floors to max(bmr, 1200).
    expect(r.tdee).toBe(500);
    expect(r.targetCalories).toBe(r.bmr);
  });

  describe("macroSplit override", () => {
    it("applies the override when set, ignoring goal+dietType defaults", () => {
      // Goal=lose normally yields 40/25/35 (P/C/F). Override to 50/30/20 and
      // make sure the actual ratios match the override, NOT the goal default.
      const r = computeMacros({
        ...baseline,
        goal: "lose",
        weeklyRateKg: 0.5,
        macroSplit: { protein: 50, carbs: 30, fat: 20 },
      });
      const proteinFraction = (r.protein * 4) / r.targetCalories;
      const carbFraction = (r.carbs * 4) / r.targetCalories;
      const fatFraction = (r.fat * 9) / r.targetCalories;
      // Tolerances cover the integer rounding inside computeMacros.
      expect(proteinFraction).toBeGreaterThan(0.48);
      expect(proteinFraction).toBeLessThan(0.52);
      expect(carbFraction).toBeGreaterThan(0.28);
      expect(carbFraction).toBeLessThan(0.32);
      expect(fatFraction).toBeGreaterThan(0.18);
      expect(fatFraction).toBeLessThan(0.22);
    });

    it("re-normalizes a split that doesn't sum to 100", () => {
      // 30/30/30 = 90 - the form lets you save it (with a yellow warning).
      // Verify the calculator scales it to a true 1/3 each rather than
      // shipping a plan whose macros sum to 90% of targetCalories.
      const r = computeMacros({
        ...baseline,
        macroSplit: { protein: 30, carbs: 30, fat: 30 },
      });
      const proteinFraction = (r.protein * 4) / r.targetCalories;
      const carbFraction = (r.carbs * 4) / r.targetCalories;
      // Each macro should land near 33.3% of calories despite the 90 sum.
      expect(proteinFraction).toBeGreaterThan(0.31);
      expect(proteinFraction).toBeLessThan(0.36);
      expect(carbFraction).toBeGreaterThan(0.31);
      expect(carbFraction).toBeLessThan(0.36);
    });

    it("falls back to goal+dietType defaults when split is null", () => {
      const a = computeMacros({ ...baseline, goal: "gain", weeklyRateKg: 0.5 });
      const b = computeMacros({
        ...baseline,
        goal: "gain",
        weeklyRateKg: 0.5,
        macroSplit: null,
      });
      expect(b.protein).toBe(a.protein);
      expect(b.carbs).toBe(a.carbs);
      expect(b.fat).toBe(a.fat);
    });

    it("falls back to defaults when override is all-zero (treated as missing)", () => {
      // A user toggles the override on, then zeros every input - treat as
      // "no override" rather than dividing by zero or producing all-zero
      // macros (which would silently kill the meal plan).
      const a = computeMacros({ ...baseline, goal: "lose", weeklyRateKg: 0.5 });
      const b = computeMacros({
        ...baseline,
        goal: "lose",
        weeklyRateKg: 0.5,
        macroSplit: { protein: 0, carbs: 0, fat: 0 },
      });
      expect(b.protein).toBe(a.protein);
      expect(b.carbs).toBe(a.carbs);
      expect(b.fat).toBe(a.fat);
    });

    it("ignores negative components in the override (clamps to zero before normalizing)", () => {
      // A junk -10 should not invert the ratio - it's clamped to 0 first.
      const positive = computeMacros({
        ...baseline,
        macroSplit: { protein: 40, carbs: 0, fat: 60 },
      });
      const withNegative = computeMacros({
        ...baseline,
        macroSplit: { protein: 40, carbs: -10, fat: 60 },
      });
      expect(withNegative.protein).toBe(positive.protein);
      expect(withNegative.carbs).toBe(positive.carbs);
      expect(withNegative.fat).toBe(positive.fat);
    });
  });
});

describe("aggregateMacroBreakdown", () => {
  it("sums fields a food contributed, omits fields no food contributed", async () => {
    const { aggregateMacroBreakdown } = await import("./macros");
    const result = aggregateMacroBreakdown([
      {
        id: 1,
        name: "Breakfast",
        foods: [
          {
            id: 1,
            name: "Cereal",
            protein: 4,
            carbs: 30,
            fat: 2,
            calories: 150,
            portionSize: 50,
            sugars: 12,
            fiber: 3,
          },
          {
            id: 2,
            name: "Milk",
            protein: 4,
            carbs: 6,
            fat: 4,
            calories: 80,
            portionSize: 100,
            sugars: 5,
            // no fiber, no fat-subtypes - those keys should still be
            // reported because *cereal* contributed fiber.
          },
        ],
      },
    ]);
    expect(result.sugars).toBe(17);
    expect(result.fiber).toBe(3);
    // No food contributed these - they're absent rather than 0.
    expect(result.saturatedFat).toBeUndefined();
    expect(result.transFat).toBeUndefined();
    expect(result.addedSugars).toBeUndefined();
  });

  it("returns an empty object when no food has any sub-macro", async () => {
    const { aggregateMacroBreakdown } = await import("./macros");
    const result = aggregateMacroBreakdown([
      {
        id: 1,
        name: "Lunch",
        foods: [
          {
            id: 1,
            name: "Plain rice",
            protein: 7,
            carbs: 80,
            fat: 1,
            calories: 360,
            portionSize: 100,
          },
        ],
      },
    ]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("rounds to one decimal so display tiles stay tidy", async () => {
    const { aggregateMacroBreakdown } = await import("./macros");
    const result = aggregateMacroBreakdown([
      {
        id: 1,
        name: "X",
        foods: [
          {
            id: 1,
            name: "a",
            protein: 0,
            carbs: 0,
            fat: 0,
            calories: 0,
            portionSize: 100,
            fiber: 1.234,
          },
          {
            id: 2,
            name: "b",
            protein: 0,
            carbs: 0,
            fat: 0,
            calories: 0,
            portionSize: 100,
            fiber: 0.789,
          },
        ],
      },
    ]);
    expect(result.fiber).toBe(2); // 2.023 → 2.0
  });
});

describe("scaleSubMacros", () => {
  it("scales present values and returns absent keys explicitly undefined", async () => {
    const { scaleSubMacros } = await import("./macros");
    const result = scaleSubMacros({ sugars: 12, fiber: 3 }, 0.5);
    expect(result.sugars).toBe(6);
    expect(result.fiber).toBe(1.5);
    // Absent values come back as EXPLICIT undefined keys, so spreading the
    // result over previous state clears a prior food's stale sub-macros.
    expect("saturatedFat" in result).toBe(true);
    expect(result.saturatedFat).toBeUndefined();
    expect("transFat" in result).toBe(true);
  });
});

describe("rescaleFoodMacros", () => {
  it("re-scales sub-macros by the portion ratio (the portion-edit fix)", async () => {
    const { rescaleFoodMacros } = await import("./macros");
    // Logged at 100 g; sub-macros already scaled to that portion. Edit to 50 g.
    const result = rescaleFoodMacros(
      { portionSize: 100, fiber: 30, saturatedFat: 9, sugars: 5 },
      50,
      { protein: 10, carbs: 60, fat: 12, calories: 300 },
    );
    // Mains come from the per-100g basis × newPortion/100.
    expect(result.protein).toBe(5);
    expect(result.carbs).toBe(30);
    expect(result.fat).toBe(6);
    expect(result.calories).toBe(150);
    // Sub-macros scale by newPortion/oldPortion (50/100).
    expect(result.fiber).toBe(15);
    expect(result.saturatedFat).toBe(4.5);
    expect(result.sugars).toBe(2.5);
  });

  it("keeps sat-fat within total fat after a downward edit (the reported bug)", async () => {
    const { rescaleFoodMacros } = await import("./macros");
    // Before the fix, sat-fat stayed frozen at the 100 g value (9) while fat
    // scaled down — producing the impossible sat-fat (9) > fat (5).
    const result = rescaleFoodMacros(
      { portionSize: 100, saturatedFat: 9 },
      50,
      { protein: 0, carbs: 0, fat: 10, calories: 100 },
    );
    expect(result.fat).toBe(5);
    expect(result.saturatedFat).toBe(4.5);
    expect(result.saturatedFat ?? 0).toBeLessThanOrEqual(result.fat);
  });

  it("leaves sub-macros the food doesn't carry absent", async () => {
    const { rescaleFoodMacros } = await import("./macros");
    const result = rescaleFoodMacros({ portionSize: 100 }, 50, {
      protein: 10,
      carbs: 5,
      fat: 2,
      calories: 80,
    });
    expect(result.protein).toBe(5);
    expect(result.fiber).toBeUndefined();
    expect(result.saturatedFat).toBeUndefined();
  });
});
