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
 *  Two sources, in priority order:
 *    1. `food.micronutrients` — exact per-100g values captured from
 *       Open Food Facts when the food was added to the meal. Most
 *       accurate (the specific product the user logged).
 *    2. The name-keyed profile cache — an approximate per-100g profile
 *       the enrichment cron derived for the food's name. Covers
 *       historical logs (added before per-food capture) and foods
 *       logged without OFF data (builtin catalog, generic names).
 *
 *  Mirrors `aggregateMacroBreakdown`'s contract exactly: a nutrient is
 *  only present in the output if at least one contributing food carried
 *  it. A food with neither source contributes nothing — partial
 *  coverage rather than a misleading zero.
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
      // Prefer the food's own captured per-100g values; fall back to
      // the name-keyed profile. Both are per-100g, so the scaling
      // below is identical either way.
      const per100Source =
        food.micronutrients ??
        profiles.get(foodNameKey(food.name))?.valuesPer100g;
      if (!per100Source) continue;
      // portionSize is grams; values are per-100g.
      const ratio = food.portionSize / 100;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      for (const key of MICRONUTRIENT_KEYS) {
        const per100 = per100Source[key];
        if (typeof per100 === "number" && Number.isFinite(per100)) {
          totals[key] = (totals[key] ?? 0) + per100 * ratio;
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
