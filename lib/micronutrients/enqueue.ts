import type { Meal } from "@/components/macro/types";
import { foodNameKey } from "./aggregate";

/** Fire-and-forget enqueue of a day's food names for background
 *  micronutrient enrichment. Called after a daily log is saved.
 *
 *  Extracts the distinct normalized food names from the meals and
 *  POSTs them to `/api/micronutrient-enqueue`. The route is the gate:
 *  it re-checks the user is Pro, skips names already enriched, and
 *  upserts the rest into the queue (on-conflict-do-nothing). So this
 *  helper stays dumb — it never decides eligibility, it just offers
 *  the names. For a guest the request 401s silently; for a free user
 *  it returns `enqueued: 0`.
 *
 *  Never awaited by the caller and never throws back: enrichment is a
 *  background nicety that must not disturb the log-save flow that
 *  triggered it.
 *
 *  v1 sends names only. A logged `FoodItem` doesn't retain the Open
 *  Food Facts barcode (it's a numeric-id item by then), so the cron
 *  resolves these via a name search. The route's `offCode` field is
 *  reserved for a future change that threads product provenance
 *  through the log. */
export function enqueueMicronutrientEnrichment(meals: Meal[]): void {
  if (typeof window === "undefined") return;
  const names = new Set<string>();
  for (const meal of meals) {
    for (const food of meal.foods) {
      const key = foodNameKey(food.name);
      if (key) names.add(key);
    }
  }
  if (names.size === 0) return;

  const items = [...names].map((nameKey) => ({ nameKey }));
  void fetch("/api/micronutrient-enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
    keepalive: true,
  }).catch(() => {
    // Swallow — best-effort. A failed enqueue just means those foods
    // get picked up on the next day-save instead.
  });
}
