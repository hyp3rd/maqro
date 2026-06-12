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
 *  Each name carries the logged item's `offCode` when one was captured
 *  (OFF search picks and barcode scans alike), so the cron can resolve
 *  the EXACT product instead of a name-search median or an AI guess —
 *  the accuracy difference for branded foods. */
export function enqueueMicronutrientEnrichment(meals: Meal[]): void {
  if (typeof window === "undefined") return;
  const byKey = new Map<string, string | undefined>();
  for (const meal of meals) {
    for (const food of meal.foods) {
      const key = foodNameKey(food.name);
      if (!key) continue;
      // First-seen code wins; a later codeless occurrence must not erase it.
      const existing = byKey.get(key);
      byKey.set(key, existing ?? food.offCode);
    }
  }
  if (byKey.size === 0) return;

  const items = [...byKey.entries()].map(([nameKey, offCode]) =>
    offCode ? { nameKey, offCode } : { nameKey },
  );
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
