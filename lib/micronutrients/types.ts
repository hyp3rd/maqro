import type { Versioned } from "@/lib/db";
import type { MicronutrientValues } from "@/lib/rda";
import type { MacroBreakdown } from "@maqro/core/types";

// `MicronutrientValues` now lives in `lib/rda` (a leaf module) so the
// food types can reference it without an import cycle. Re-exported
// here for the existing call sites that import it from this module.
export type { MicronutrientValues } from "@/lib/rda";

export type MicronutrientProfile = {
  /** Lowercased + trimmed food name — the join key against
   *  `meals[].foods[].name`. */
  nameKey: string;
  /** How the values were resolved:
   *   - `barcode`: exact Open Food Facts product lookup (high
   *     confidence, single product).
   *   - `ciqual`: ANSES-CIQUAL curated lab values for a generic food
   *     (high confidence, reference data).
   *   - `search`: name search median across the top OFF matches
   *     (approximate, but grounded in real product data).
   *   - `ai`: an AI estimate, used only when Open Food Facts had no
   *     match. Approximate, with no product source — flagged distinctly
   *     so a medical reader knows it's a model guess, not product data.
   *   - `miss`: no usable match from OFF or AI. The profile is written
   *     anyway, with empty `valuesPer100g`, so the cron stops
   *     re-querying a name that will likely never resolve. The report
   *     renders these foods as "no data".
   *  Surfaced in the report so a medical reader can weigh the data. */
  source: "barcode" | "ciqual" | "search" | "ai" | "miss";
  /** The OFF product code the values came from, when known. An exact
   *  code arriving later (the user re-logs the product) re-queues a
   *  non-barcode profile so it upgrades to the actual product's values. */
  sourceCode?: string;
  /** Per-100g values in each nutrient's canonical unit (see
   *  [lib/rda.ts](../rda.ts)). */
  valuesPer100g: MicronutrientValues;
  /** Per-100g macro-breakdown values (sugars, saturated fat, …) resolved
   *  by the same cron from the same source, so foods logged without OFF
   *  data still get a breakdown. Absent on profiles written before the
   *  backfill shipped. */
  breakdownPer100g?: MacroBreakdown;
  /** When the cron last wrote this profile (epoch ms). */
  enrichedAt: number;
} & Versioned;

/** Summed micronutrient totals across a set of meals / a day / a
 *  window — the output of the aggregation layer, in canonical units.
 *  Same shape as `MicronutrientValues`; named distinctly so call
 *  sites read clearly ("these are totals, not per-100g"). */
export type MicronutrientTotals = MicronutrientValues;
