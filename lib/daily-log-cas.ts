import type { Meal } from "@maqro/core/types";

/** Cheap structural compare of two days' meals. Meal arrays are one day's
 *  worth, so JSON serialization is negligible. Shared by `useDailyLog` (to
 *  ignore its own data-bus echo) and the compare-and-swap helpers below. */
export function sameMeals(a: readonly Meal[], b: readonly Meal[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Compare-and-swap for a whole-day replacement (AI auto-fill / refine, the
 *  formula planner). `expected` is the day the plan was computed from; the
 *  plan is applied only if the day still looks exactly like that. Returns
 *  `null` when the day changed in the meantime (a food logged, a meal
 *  cleared, a peer device's edit) so the caller drops the stale plan instead
 *  of overwriting those edits. */
export function replaceDayIfUnchanged(
  latest: readonly Meal[],
  expected: readonly Meal[],
  next: Meal[],
): Meal[] | null {
  return sameMeals(latest, expected) ? next : null;
}

/** Compare-and-swap for a single-slot replacement (AI per-meal regenerate).
 *  Swaps only the slot whose id matches `expected.id`, keeping every other
 *  slot exactly as it is in `latest` — so an edit to another meal made while
 *  the request was in flight survives. Returns `null` when that slot is gone
 *  or no longer matches what the regeneration was computed from. */
export function replaceMealIfUnchanged(
  latest: readonly Meal[],
  expected: Meal,
  next: Meal,
): Meal[] | null {
  const current = latest.find((m) => m.id === expected.id);
  if (!current || !sameMeals([current], [expected])) return null;
  return latest.map((m) => (m.id === expected.id ? next : m));
}
