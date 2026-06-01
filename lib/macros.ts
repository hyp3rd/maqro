import {
  type CalculatedValues,
  KCAL_PER_KG,
  MIN_DAILY_KCAL,
  type PersonalInfo,
  activityMultipliers,
  goalDirection,
} from "@/components/macro/types";
import type { MacroBreakdown, Meal } from "@/components/macro/types";

/** Pure computation of BMR, TDEE, target calories, daily delta, and per-macro
 * gram targets from the user's profile. Uses Mifflin-St Jeor for BMR. The
 * daily delta is clamped so the target never drops below max(BMR, 1200) and
 * the rate is clamped to ≤1% of bodyweight/week (textbook upper bound). */
export function computeMacros(p: PersonalInfo): CalculatedValues {
  // Mifflin-St Jeor has two paths: +5 (assumed-male physiology) or -161
  // (assumed-female physiology). For non-binary / prefer-not-to-say we
  // pick the lower-calorie estimate (-161). It's the conservative choice:
  // under-estimating energy needs is safer than over-estimating, and the
  // manual TDEE override lets anyone calibrate against real-world results.
  const malePath = p.gender === "male";
  const bmr = malePath
    ? 10 * p.weight + 6.25 * p.height - 5 * p.age + 5
    : 10 * p.weight + 6.25 * p.height - 5 * p.age - 161;

  // Manual TDEE overrides the formula-based estimate when provided. Without
  // it, we use BMR × activity multiplier, which is a textbook approximation
  // known to overestimate real-world TDEE by 10–20% for many people.
  const formulaTdee = bmr * activityMultipliers[p.activityLevel];
  const tdee = p.manualTdee && p.manualTdee > 0 ? p.manualTdee : formulaTdee;

  const safeRate = Math.min(Math.max(p.weeklyRateKg, 0), p.weight * 0.01);
  const requestedDelta = goalDirection[p.goal] * ((safeRate * KCAL_PER_KG) / 7);
  const floor = Math.max(bmr, MIN_DAILY_KCAL);
  const targetCalories = Math.max(tdee + requestedDelta, floor);
  const dailyDelta = targetCalories - tdee;

  let proteinRatio: number;
  let fatRatio: number;
  let carbRatio: number;

  // Manual override wins. The user provides percentages (any non-negative
  // numbers); we re-normalize to ratios that sum to 1 so a slightly-off
  // sum (e.g. 30/30/30) still yields valid targets. If everything is zero
  // or non-finite the override is treated as missing — fall back to the
  // goal-aware default below.
  const split = p.macroSplit ?? null;
  const overrideSum = split
    ? Math.max(split.protein, 0) +
      Math.max(split.carbs, 0) +
      Math.max(split.fat, 0)
    : 0;
  const useOverride =
    split !== null && Number.isFinite(overrideSum) && overrideSum > 0;

  if (useOverride && split) {
    proteinRatio = Math.max(split.protein, 0) / overrideSum;
    carbRatio = Math.max(split.carbs, 0) / overrideSum;
    fatRatio = Math.max(split.fat, 0) / overrideSum;
  } else {
    if (p.goal === "lose") {
      proteinRatio = 0.4;
      fatRatio = 0.35;
      carbRatio = 0.25;
    } else if (p.goal === "gain") {
      proteinRatio = 0.3;
      fatRatio = 0.25;
      carbRatio = 0.45;
    } else {
      proteinRatio = 0.3;
      fatRatio = 0.3;
      carbRatio = 0.4;
    }

    if (p.dietType === "lowCarb") {
      carbRatio = Math.max(0.15, carbRatio - 0.2);
      proteinRatio = Math.min(0.4, proteinRatio + 0.05);
      fatRatio = 1 - proteinRatio - carbRatio;
    } else if (p.dietType === "lowFat") {
      fatRatio = Math.max(0.15, fatRatio - 0.15);
      proteinRatio = Math.min(0.4, proteinRatio + 0.05);
      carbRatio = 1 - proteinRatio - fatRatio;
    }
  }

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCalories: Math.round(targetCalories),
    dailyDelta: Math.round(dailyDelta),
    requestedDelta: Math.round(requestedDelta),
    protein: Math.round((targetCalories * proteinRatio) / 4),
    carbs: Math.round((targetCalories * carbRatio) / 4),
    fat: Math.round((targetCalories * fatRatio) / 9),
  };
}

/** Sum the optional macro-breakdown fields across every FoodItem in the
 *  passed meals. Only includes a key in the output when at least one
 *  food contributed a value — otherwise the display layer would render
 *  a misleading "0g" for fields where we have no information.
 *
 *  Foods that don't carry sub-macros (seed catalog rows, older custom
 *  foods saved before the breakdown migration, items added through
 *  paths that don't yet propagate the per-100g scaling) simply skip
 *  the sum for those fields. */
export function aggregateMacroBreakdown(meals: Meal[]): MacroBreakdown {
  const totals: Record<keyof MacroBreakdown, number> = {
    sugars: 0,
    addedSugars: 0,
    fiber: 0,
    saturatedFat: 0,
    transFat: 0,
    monoFat: 0,
    polyFat: 0,
  };
  const seen: Record<keyof MacroBreakdown, boolean> = {
    sugars: false,
    addedSugars: false,
    fiber: false,
    saturatedFat: false,
    transFat: false,
    monoFat: false,
    polyFat: false,
  };
  for (const meal of meals) {
    for (const food of meal.foods) {
      for (const key of Object.keys(totals) as Array<keyof MacroBreakdown>) {
        const v = food[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          totals[key] += v;
          seen[key] = true;
        }
      }
    }
  }
  const out: MacroBreakdown = {};
  for (const key of Object.keys(totals) as Array<keyof MacroBreakdown>) {
    if (seen[key]) {
      out[key] = Math.round(totals[key] * 10) / 10;
    }
  }
  return out;
}
