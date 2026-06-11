import type { Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { MICRONUTRIENT_KEYS, type MicronutrientKey } from "@/lib/rda";
import type { MicronutrientProfile, MicronutrientTotals } from "./types";

/** Lowercased + trimmed food name — the join key between a logged
 *  food and its micronutrient profile. Kept local (a one-liner) so the
 *  micronutrient layer doesn't import from the shopping-list module;
 *  the normalization is intentionally identical to `nameKey` there. */
export function foodNameKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Sum micronutrient totals across a set of meals, scaling each food's
 *  per-100g values by its portion.
 *
 *  Two sources, merged PER NUTRIENT, in priority order:
 *    1. `food.micronutrients` — exact per-100g values captured from
 *       Open Food Facts when the food was added to the meal. Most
 *       accurate (the specific product the user logged).
 *    2. The name-keyed profile cache — an approximate per-100g profile
 *       the enrichment cron derived for the food's name. Covers
 *       historical logs (added before per-food capture), foods logged
 *       without OFF data (builtin catalog, generic names), AND the
 *       nutrients a product's partial OFF data didn't list. OFF rows
 *       routinely carry just a couple of values (say sodium + calcium);
 *       falling back per-food instead of per-nutrient used to discard
 *       the profile's fiber/iron/zinc for exactly those foods.
 *
 *  Fiber additionally falls back to the food's top-level scaled
 *  `MacroBreakdown.fiber` (the macro-side store) when neither per-100g
 *  source knows it — fiber is the one nutrient tracked by both systems,
 *  and the two surfaces (macro breakdown line, micronutrient panel)
 *  must not contradict each other on the same screen.
 *
 *  Mirrors `aggregateMacroBreakdown`'s contract exactly: a nutrient is
 *  only present in the output if at least one contributing food carried
 *  it. A food with no source contributes nothing — partial coverage
 *  rather than a misleading zero.
 *
 *  Profiles are passed in as a Map keyed by `foodNameKey` so the caller
 *  controls the I/O (read from IDB once, aggregate many days) and this
 *  function stays pure. */
export function aggregateMicronutrients(
  meals: Meal[],
  profiles: Map<string, MicronutrientProfile>,
): MicronutrientTotals {
  const totals = {} as Record<MicronutrientKey, number>;
  const seen = {} as Record<MicronutrientKey, boolean>;

  for (const meal of meals) {
    for (const food of meal.foods) {
      const own = food.micronutrients;
      const profile = profiles.get(foodNameKey(food.name))?.valuesPer100g;
      // portionSize is grams; values are per-100g.
      const ratio = food.portionSize / 100;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      for (const key of MICRONUTRIENT_KEYS) {
        // Per-nutrient merge: the product's own value wins; the profile
        // fills the nutrients the product didn't list.
        const ownV = own?.[key];
        const per100 =
          typeof ownV === "number" && Number.isFinite(ownV)
            ? ownV
            : profile?.[key];
        if (typeof per100 === "number" && Number.isFinite(per100)) {
          totals[key] = (totals[key] ?? 0) + per100 * ratio;
          seen[key] = true;
        } else if (
          key === "fiber" &&
          typeof food.fiber === "number" &&
          Number.isFinite(food.fiber)
        ) {
          // Macro-side fiber is already scaled to the portion — add as-is.
          totals[key] = (totals[key] ?? 0) + food.fiber;
          seen[key] = true;
        }
      }
    }
  }

  const out: MicronutrientTotals = {};
  for (const key of MICRONUTRIENT_KEYS) {
    if (seen[key]) {
      // Round to 1 decimal — matches the macro aggregator's precision
      // and keeps µg vitamins from rendering 14-digit float tails.
      out[key] = Math.round(totals[key] * 10) / 10;
    }
  }
  return out;
}

/** The meal's best-known fiber, resolved per food with the SAME priority
 *  chain `aggregateMicronutrients` uses for its fiber row — product
 *  per-100g micros, then the name-keyed profile, then the macro-side
 *  scaled `MacroBreakdown.fiber` — so the breakdown line, the fiber
 *  insight, and the micronutrient panel all show one number.
 *
 *  Also reports how much of the meal is actually *known*:
 *  `knownCalorieShare` is the calorie share of foods that contributed a
 *  fiber value from any source. A "low fiber" claim built on one
 *  known-zero food out of six is not a claim worth making — the caller
 *  gates the warning on this share. `grams` is undefined when no food
 *  has any fiber source (absent ≠ zero). */
export function resolveMealFiber(
  meal: Meal,
  profiles: Map<string, MicronutrientProfile>,
): { grams: number | undefined; knownCalorieShare: number } {
  let any = false;
  let sum = 0;
  let knownCalories = 0;
  let totalCalories = 0;
  for (const food of meal.foods) {
    totalCalories += food.calories;
    const ownV = food.micronutrients?.fiber;
    const per100 =
      typeof ownV === "number" && Number.isFinite(ownV)
        ? ownV
        : profiles.get(foodNameKey(food.name))?.valuesPer100g.fiber;
    const ratio = food.portionSize / 100;
    let grams: number | undefined;
    if (
      typeof per100 === "number" &&
      Number.isFinite(per100) &&
      Number.isFinite(ratio) &&
      ratio > 0
    ) {
      grams = per100 * ratio;
    } else if (typeof food.fiber === "number" && Number.isFinite(food.fiber)) {
      grams = food.fiber; // already scaled to the portion
    }
    if (grams !== undefined) {
      any = true;
      sum += grams;
      knownCalories += food.calories;
    }
  }
  return {
    grams: any ? Math.round(sum * 10) / 10 : undefined,
    knownCalorieShare: totalCalories > 0 ? knownCalories / totalCalories : 0,
  };
}

/** A single day's micronutrient totals, tagged with its date. */
export type MicronutrientDay = { date: string; totals: MicronutrientTotals };

/** Build a per-day micronutrient series over the last `days` days,
 *  for the trend charts. Mirrors `computeWeeklyRecap`'s windowing:
 *  only days that actually have logs (and at least one enriched food)
 *  appear — no zero-padding, so a sparse history reads honestly.
 *
 *  `today` is passed in (not read from a clock) so the function stays
 *  pure and testable; callers supply the local day key. Future-dated
 *  meal-plan entries are excluded (date > today). */
export function computeMicronutrientWindow(
  logs: DailyLog[],
  profiles: Map<string, MicronutrientProfile>,
  today: string,
  days: number,
): MicronutrientDay[] {
  const out: MicronutrientDay[] = [];
  for (const log of logs) {
    if (log.date > today) continue;
    const totals = aggregateMicronutrients(log.meals, profiles);
    // Skip days where no food was enriched — an empty totals object
    // carries no signal and would just be a gap in every chart.
    if (Object.keys(totals).length === 0) continue;
    out.push({ date: log.date, totals });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days > 0 ? out.slice(-days) : out;
}

/** Average per-nutrient intake across the days in a window — the
 *  "habitual intake" figure a medical reader cares about, smoothing
 *  out day-to-day noise. Each nutrient is averaged ONLY over the days
 *  that actually carried it (not the whole window), matching the
 *  omit-unseen contract: a nutrient present on 3 of 10 logged days
 *  reports the mean of those 3, not a window-diluted figure. Returns
 *  an empty object for an empty window. */
export function averageMicronutrients(
  days: MicronutrientDay[],
): MicronutrientTotals {
  const sums = {} as Record<MicronutrientKey, number>;
  const counts = {} as Record<MicronutrientKey, number>;
  for (const day of days) {
    for (const key of MICRONUTRIENT_KEYS) {
      const v = day.totals[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        sums[key] = (sums[key] ?? 0) + v;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  const out: MicronutrientTotals = {};
  for (const key of MICRONUTRIENT_KEYS) {
    if (counts[key] > 0) {
      out[key] = Math.round((sums[key] / counts[key]) * 10) / 10;
    }
  }
  return out;
}
