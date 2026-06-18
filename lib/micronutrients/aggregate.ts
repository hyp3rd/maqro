import type { MacroBreakdown, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { MICRONUTRIENT_KEYS, type MicronutrientKey } from "@/lib/rda";
import { SUB_MACRO_KEYS } from "@maqro/core/macros";
import type { MicronutrientProfile, MicronutrientTotals } from "./types";

/** Lowercased + trimmed food name — the join key between a logged
 *  food and its micronutrient profile. Kept local (a one-liner) so the
 *  micronutrient layer doesn't import from the shopping-list module;
 *  the normalization is intentionally identical to `nameKey` there. */
export function foodNameKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Per-nutrient precision flag that travels ALONGSIDE the totals (the totals
 *  themselves are a flat number map with nowhere to hang a tag — exactly why
 *  `daysWith` is a parallel map too). `true` means the value is an
 *  APPROXIMATION: at least one food/day that contributed to it came from a
 *  similar-food estimate, an AI guess, the macro-side fiber fallback, or a
 *  product whose exact barcode wasn't captured. Absent ⇒ every contributor was
 *  an exact, barcode-matched product (or a curated lab reference). */
export type MicronutrientProvenance = Partial<
  Record<MicronutrientKey, boolean>
>;

/** A profile is "exact" only when its values came from a single barcode-matched
 *  product or a curated lab reference (CIQUAL). Name-search medians and AI
 *  guesses are approximations; a `miss` carries no values at all. */
function profileSourceIsExact(source: MicronutrientProfile["source"]): boolean {
  return source === "barcode" || source === "ciqual";
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
  return aggregateMicronutrientsDetailed(meals, profiles).totals;
}

/** `aggregateMicronutrients` plus the per-nutrient precision flag the UI needs
 *  to mark an "≈ estimated" value honestly. The numbers are IDENTICAL to the
 *  plain variant — this only also records, per nutrient, whether any
 *  contributing food was an approximation.
 *
 *  Worst-case (conservative) reduction: a total is exact ONLY if EVERY food
 *  that fed it was exact. Any approximate contributor flips the whole summed
 *  value to approximate. On a precision-sensitive nutrition panel a false
 *  "≈ estimated" is harmless; a false "exact" is the error to avoid.
 *
 *  Per-contributor exactness (the offCode-gated rule):
 *    - the food's OWN per-100g micros are exact only when the food carries an
 *      `offCode` (a barcode-matched product the user actually logged); a
 *      builtin / generic / AI-derived catalog value has none → approximate;
 *    - a name-keyed profile value is exact only when its source is a barcode
 *      or curated lab reference (`profileSourceIsExact`);
 *    - the macro-side fiber fallback is always an approximation. */
export function aggregateMicronutrientsDetailed(
  meals: Meal[],
  profiles: Map<string, MicronutrientProfile>,
): { totals: MicronutrientTotals; approx: MicronutrientProvenance } {
  const totals = {} as Record<MicronutrientKey, number>;
  const seen = {} as Record<MicronutrientKey, boolean>;
  const approx = {} as Record<MicronutrientKey, boolean>;

  for (const meal of meals) {
    for (const food of meal.foods) {
      const own = food.micronutrients;
      const profileRow = profiles.get(foodNameKey(food.name));
      const profile = profileRow?.valuesPer100g;
      // The food's own micros are trustworthy-as-exact only when we captured
      // the exact product (a barcode). Otherwise the value is some catalog
      // food's per-100g, which can itself be a generic / search / AI figure.
      const ownIsExact =
        typeof food.offCode === "string" && food.offCode.trim().length > 0;
      const profileIsExact = profileRow
        ? profileSourceIsExact(profileRow.source)
        : false;
      // portionSize is grams; values are per-100g.
      const ratio = food.portionSize / 100;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      for (const key of MICRONUTRIENT_KEYS) {
        // Per-nutrient merge: the product's own value wins; the profile
        // fills the nutrients the product didn't list.
        const ownV = own?.[key];
        const usingOwn = typeof ownV === "number" && Number.isFinite(ownV);
        const per100 = usingOwn ? ownV : profile?.[key];
        if (typeof per100 === "number" && Number.isFinite(per100)) {
          totals[key] = (totals[key] ?? 0) + per100 * ratio;
          seen[key] = true;
          if (!(usingOwn ? ownIsExact : profileIsExact)) approx[key] = true;
        } else if (
          key === "fiber" &&
          typeof food.fiber === "number" &&
          Number.isFinite(food.fiber)
        ) {
          // Macro-side fiber is already scaled to the portion — add as-is.
          totals[key] = (totals[key] ?? 0) + food.fiber;
          seen[key] = true;
          approx[key] = true; // macro-side fallback is an approximation
        }
      }
    }
  }

  const out: MicronutrientTotals = {};
  const outApprox: MicronutrientProvenance = {};
  for (const key of MICRONUTRIENT_KEYS) {
    if (seen[key]) {
      // Round to 1 decimal — matches the macro aggregator's precision
      // and keeps µg vitamins from rendering 14-digit float tails.
      out[key] = Math.round(totals[key] * 10) / 10;
      if (approx[key]) outApprox[key] = true;
    }
  }
  return { totals: out, approx: outApprox };
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

/** Sum the MacroBreakdown sub-macros across meals with the profile-backed
 *  fallback — the breakdown twin of `aggregateMicronutrients`, replacing the
 *  top-level-only `aggregateMacroBreakdown` wherever profiles are available.
 *
 *  ONE per-food chain, shared with the meal sheet so the day totals and the
 *  per-meal view can never disagree on the same data:
 *    - fiber: exactly `resolveMealFiber`'s chain — product micros → profile
 *      micros (per-100g × portion) → macro-side scaled value.
 *    - every other key: the food's own scaled value first (exact product
 *      data captured at log time) → the profile's per-100g breakdown
 *      backfill × portion. The order differs from fiber deliberately: the
 *      top-level value IS the product's own label here, while the profile
 *      is a name-keyed approximation.
 *  Same omit-unseen contract as every aggregator: a key appears only when
 *  at least one food contributed it. */
export function aggregateBreakdownWithProfiles(
  meals: Meal[],
  profiles: Map<string, MicronutrientProfile>,
): MacroBreakdown {
  const totals = {} as Record<keyof MacroBreakdown, number>;
  const seen = {} as Record<keyof MacroBreakdown, boolean>;
  for (const key of SUB_MACRO_KEYS) {
    totals[key] = 0;
    seen[key] = false;
  }
  for (const meal of meals) {
    for (const food of meal.foods) {
      const profile = profiles.get(foodNameKey(food.name));
      const ratio = food.portionSize / 100;
      const ratioOk = Number.isFinite(ratio) && ratio > 0;
      for (const key of SUB_MACRO_KEYS) {
        let grams: number | undefined;
        if (key === "fiber") {
          const ownV = food.micronutrients?.fiber;
          const per100 =
            typeof ownV === "number" && Number.isFinite(ownV)
              ? ownV
              : profile?.valuesPer100g.fiber;
          if (
            typeof per100 === "number" &&
            Number.isFinite(per100) &&
            ratioOk
          ) {
            grams = per100 * ratio;
          } else if (
            typeof food.fiber === "number" &&
            Number.isFinite(food.fiber)
          ) {
            grams = food.fiber;
          }
        } else {
          const own = food[key];
          const backfill = profile?.breakdownPer100g?.[key];
          if (typeof own === "number" && Number.isFinite(own)) {
            grams = own;
          } else if (
            typeof backfill === "number" &&
            Number.isFinite(backfill) &&
            ratioOk
          ) {
            grams = backfill * ratio;
          }
        }
        if (grams !== undefined) {
          totals[key] += grams;
          seen[key] = true;
        }
      }
    }
  }
  const out: MacroBreakdown = {};
  for (const key of SUB_MACRO_KEYS) {
    if (seen[key]) out[key] = Math.round(totals[key] * 10) / 10;
  }
  return out;
}

/** A single day's micronutrient totals, tagged with its date + the
 *  per-nutrient precision flag (see `MicronutrientProvenance`). */
export type MicronutrientDay = {
  date: string;
  totals: MicronutrientTotals;
  approx: MicronutrientProvenance;
};

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
    const { totals, approx } = aggregateMicronutrientsDetailed(
      log.meals,
      profiles,
    );
    // Skip days where no food was enriched — an empty totals object
    // carries no signal and would just be a gap in every chart.
    if (Object.keys(totals).length === 0) continue;
    out.push({ date: log.date, totals, approx });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days > 0 ? out.slice(-days) : out;
}

export type MicronutrientAverages = {
  /** Per-nutrient mean over the days that carried it (see the contract
   *  above — NOT diluted across the whole window). */
  totals: MicronutrientTotals;
  /** Per nutrient: how many of the window's tracked days actually carried
   *  it. A mean built on 2 of 20 days is a very different claim than one
   *  built on 18 of 20 — the UI surfaces this so the average can't read
   *  as more habitual than the data supports. */
  daysWith: Partial<Record<MicronutrientKey, number>>;
  /** Per-nutrient precision over the window: `true` when ANY contributing day
   *  was an approximation (the conservative reduction — see
   *  `aggregateMicronutrientsDetailed`). Drives the "≈ estimated" marker. */
  approx: MicronutrientProvenance;
  /** Tracked days in the window (days with at least one enriched food). */
  dayCount: number;
};

/** Average per-nutrient intake across the days in a window — the "habitual
 *  intake" figure a medical reader cares about, smoothing out day-to-day noise.
 *  Each nutrient is averaged ONLY over the days that actually carried it (not
 *  the whole window), matching the omit-unseen contract: a nutrient present on
 *  3 of 10 logged days reports the mean of those 3, not a window-diluted figure.
 *  Plus the per-nutrient coverage + precision needed to display the average
 *  honestly ("≈ 12 mg · on 8 of 20 tracked days"). Empty for an empty window. */
export function averageMicronutrientsDetailed(
  days: MicronutrientDay[],
): MicronutrientAverages {
  const sums = {} as Record<MicronutrientKey, number>;
  const counts = {} as Record<MicronutrientKey, number>;
  const approxAny = {} as Record<MicronutrientKey, boolean>;
  for (const day of days) {
    for (const key of MICRONUTRIENT_KEYS) {
      const v = day.totals[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        sums[key] = (sums[key] ?? 0) + v;
        counts[key] = (counts[key] ?? 0) + 1;
        // A window average is exact only if EVERY contributing day was exact.
        if (day.approx[key]) approxAny[key] = true;
      }
    }
  }
  const totals: MicronutrientTotals = {};
  const daysWith: Partial<Record<MicronutrientKey, number>> = {};
  const approx: MicronutrientProvenance = {};
  for (const key of MICRONUTRIENT_KEYS) {
    if (counts[key] > 0) {
      totals[key] = Math.round((sums[key] / counts[key]) * 10) / 10;
      daysWith[key] = counts[key];
      if (approxAny[key]) approx[key] = true;
    }
  }
  return { totals, daysWith, approx, dayCount: days.length };
}
