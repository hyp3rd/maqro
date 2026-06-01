import type { PantryItem } from "@/lib/db";
import { LOW_STOCK_THRESHOLD, isMeasuredUnit } from "@/lib/pantry/consume";

/** Items from the pantry worth restocking — the seed for "Shop for me".
 *
 *  - Anything empty (`quantity <= 0`) regardless of unit.
 *  - Count / free-text items at or below `LOW_STOCK_THRESHOLD` ("down to
 *    the last one"). Measured items (mass or volume — kg, g, l, ml, …)
 *    have no universal "low" amount — 1 kg of flour is plenty, 1 kg of
 *    saffron is a lifetime — so only an empty measured item qualifies,
 *    matching the asymmetry in
 *    [lib/pantry/consume.ts](../pantry/consume.ts)'s low-stock rule.
 *
 *  Newest-empty-first ordering isn't meaningful here; we preserve the
 *  caller's order. Pure: no I/O, no mutation. */
export function pantryGapItems(items: PantryItem[]): PantryItem[] {
  return items.filter((item) => {
    if (item.quantity <= 0) return true;
    if (isMeasuredUnit(item.unit)) return false;
    return item.quantity <= LOW_STOCK_THRESHOLD;
  });
}
