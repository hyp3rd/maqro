import type { DailyLog, PantryItem, ShoppingListMeta } from "@/lib/db";

/** A single line in the aggregated shopping list. One row per
 *  unique food name across the selected date range, with the total
 *  grams summed and a `appearances` count so the UI can show "used
 *  in 3 meals this week" for context. */
export type ShoppingItem = {
  /** Canonical food name (matches whatever the user / catalog
   *  stored on the FoodItem). Case-preserved from the first
   *  occurrence so the display reads naturally. */
  name: string;
  /** Total grams of this food across the date range, rounded to
   *  the nearest gram for shop-floor utility (grocery stores
   *  don't sell 87.3 g packs). */
  totalGrams: number;
  /** How many meal slots this food appears in across the range.
   *  Drives the "used 3× this week" supplementary line in the UI. */
  appearances: number;
  /** Estimated total calories — handy when planning portions and
   *  also a sanity check that the line item isn't a typo (a
   *  10 000 kcal item means a portion got entered wrong). */
  totalCalories: number;
};

/** Inclusive `YYYY-MM-DD` date list from `start` to `end`. Local-
 *  date arithmetic — matches the rest of the app's day-key
 *  convention. */
export function datesBetween(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const stop = new Date(ey, em - 1, ed);
  const out: string[] = [];
  while (cur.getTime() <= stop.getTime()) {
    const yy = cur.getFullYear();
    const mm = (cur.getMonth() + 1).toString().padStart(2, "0");
    const dd = cur.getDate().toString().padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Aggregate the foods across a date range into a shopping list.
 *  Sort order is "biggest first" — that's the most useful
 *  ordering for shop-floor scanning (you spot the staples
 *  immediately). The caller can re-sort by name in the UI if they
 *  prefer.
 *
 *  Name matching is exact + case-insensitive. "Chicken Breast" and
 *  "chicken breast" merge into one row using the first-seen
 *  capitalization; this is the same loose-equality the meal-plan
 *  catalog uses. */
export function computeShoppingList(
  logs: DailyLog[],
  startDate: string,
  endDate: string,
): ShoppingItem[] {
  const window = new Set(datesBetween(startDate, endDate));
  // Map keyed by lowercased name → accumulator. We track the
  // original casing separately so the output reads naturally.
  const acc = new Map<
    string,
    {
      displayName: string;
      totalGrams: number;
      appearances: number;
      totalCalories: number;
    }
  >();
  for (const log of logs) {
    if (!window.has(log.date)) continue;
    for (const meal of log.meals) {
      for (const f of meal.foods) {
        const key = f.name.toLowerCase().trim();
        if (!key) continue;
        const existing = acc.get(key);
        if (existing) {
          existing.totalGrams += f.portionSize ?? 0;
          existing.totalCalories += f.calories;
          existing.appearances += 1;
        } else {
          acc.set(key, {
            displayName: f.name,
            totalGrams: f.portionSize ?? 0,
            totalCalories: f.calories,
            appearances: 1,
          });
        }
      }
    }
  }
  const items: ShoppingItem[] = [...acc.values()].map((v) => ({
    name: v.displayName,
    totalGrams: Math.round(v.totalGrams),
    appearances: v.appearances,
    totalCalories: Math.round(v.totalCalories),
  }));
  // Sort biggest portion first; ties broken alphabetically so the
  // ordering is stable across re-renders.
  items.sort(
    (a, b) =>
      b.totalGrams - a.totalGrams ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return items;
}

/** A row as the UI renders it. Either a real aggregated item from
 *  the meal logs (no `isExtra`) or a manual extra the user sent in
 *  from a pantry low-stock row (`isExtra: true`, carries its own
 *  `extraUnit` so the row reads "5 eggs" not "5 g"). */
export type DisplayItem = ShoppingItem & {
  isExtra?: boolean;
  extraUnit?: string;
};

/** Lowercased + trimmed name — the lookup key shared between the
 *  shopping list aggregator, the meta store, and the pantry-name
 *  index. */
export function nameKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Compose the user-facing shopping list from the three layers:
 *
 *    1. `computeShoppingList(logs, ...)` — the canonical aggregate
 *       from logged meals, in grams.
 *    2. `shoppingListMeta` — per-item user overrides:
 *       - `excluded: true` filters the row out entirely;
 *       - `qtyOverride` replaces the aggregate's `totalGrams`;
 *       - `appearancesOverride` replaces the "Nx" count;
 *       - `extraQty` + `extraUnit` inject a manual "Restock" row
 *         (skipped when an item with the same name already appears
 *         in the computed set, OR when the meta is `excluded`).
 *    3. `pantryByName` — used to title-case the display name of an
 *       extra that doesn't match any current pantry entry (rare —
 *       it'd require the user to send-to-list, then delete the
 *       pantry item separately).
 *
 *  Pure: no I/O, no state. Re-used by ShoppingListView (live) and
 *  the `/shopping-report` PDF page so both surfaces show the same
 *  derived rows. Tested in `shopping-list.test.ts`. */
export function buildDisplayItems(
  items: ShoppingItem[],
  meta: Map<string, ShoppingListMeta>,
  pantryByName: Map<string, PantryItem>,
): DisplayItem[] {
  const computed: DisplayItem[] = [];
  for (const it of items) {
    const m = meta.get(nameKey(it.name));
    if (m?.excluded) continue;
    const qtyOverride = m?.qtyOverride;
    const appearancesOverride = m?.appearancesOverride;
    const withQty =
      qtyOverride && qtyOverride > 0
        ? { ...(it as DisplayItem), totalGrams: qtyOverride }
        : (it as DisplayItem);
    computed.push(
      appearancesOverride && appearancesOverride > 0
        ? { ...withQty, appearances: appearancesOverride }
        : withQty,
    );
  }
  const seenKeys = new Set(items.map((it) => nameKey(it.name)));
  const extras: DisplayItem[] = [];
  for (const [key, m] of meta) {
    if (!m.extraQty || m.extraQty <= 0) continue;
    // The previous extras-aren't-filtered-by-excluded bug lived here.
    // An item that the user deleted AND that has an extra quantity
    // from a pantry "send to list" should still respect the delete.
    if (m.excluded) continue;
    if (seenKeys.has(key)) continue;
    const displayName =
      pantryByName.get(key)?.name ??
      key
        .split(" ")
        .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
    extras.push({
      name: displayName,
      totalGrams: m.extraQty,
      appearances: 0,
      totalCalories: 0,
      isExtra: true,
      extraUnit: m.extraUnit ?? "g",
    });
  }
  return [...computed, ...extras];
}
