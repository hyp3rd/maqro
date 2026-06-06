import type { Meal } from "@/components/macro/types";

/** Pure helpers for the meal-prep "apply this recipe across a date
 *  range" flow. Date math is component-based (YYYY-MM-DD strings)
 *  rather than Date-arithmetic so DST transitions and timezone
 *  quirks don't shift the range — a user picking "Mon to Fri" on
 *  a spring-forward week gets exactly five entries, not four or six. */

/** The base meals for a batch-apply target day, before the recipe is appended.
 *  A day that already has a log keeps its own meals. A day with NO log yet gets
 *  the fallback slot LAYOUT — the same slot names / ids / sort order the user
 *  has today — but with EMPTY foods.
 *
 *  Critically NOT a copy of the fallback day's foods: cloning `m.foods` here
 *  would stamp today's entire day (every meal, recipe or not) onto every target
 *  day, then the caller would append the recipe on top — duplicating the target
 *  slot and pasting the rest of the day's meals where nothing was scheduled. */
export function scaffoldBatchDay(
  existing: readonly Meal[] | null,
  fallback: readonly Meal[],
): readonly Meal[] {
  if (existing) return existing;
  return fallback.map((m) => ({ ...m, foods: [] }));
}

/** Enumerate every YYYY-MM-DD between `start` and `end` inclusive,
 *  in ascending order. Returns an empty array if start > end (the UI
 *  should swap or validate first; this function trusts inputs). */
export function enumerateDateRange(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let cur = start;
  // Hard cap at 366 to keep a degenerate "5 years from now" entry
  // from synthesizing thousands of dates and tying up the UI.
  for (let i = 0; i < 366 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Return only the dates whose day-of-week is in `allowed`. The
 *  set uses JavaScript's `Date#getDay()` convention (0 = Sunday,
 *  6 = Saturday). When all seven are allowed, the input is
 *  returned unchanged so callers can short-circuit the filter. */
export function filterByDayOfWeek(
  dates: readonly string[],
  allowed: ReadonlySet<number>,
): string[] {
  if (allowed.size === 7) return [...dates];
  return dates.filter((d) => allowed.has(dayOfWeek(d)));
}

/** Day-of-week (0 = Sunday) for a YYYY-MM-DD string. Uses the
 *  *local* timezone interpretation so the answer matches what the
 *  user sees in a calendar app: "Tuesday May 21" returns 2,
 *  regardless of UTC offset. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return 0;
  return new Date(y, m - 1, d).getDay();
}

/** Add `days` to a YYYY-MM-DD string. Negative values move
 *  backwards. Component-based via `setDate` so a 1-day add across
 *  spring-forward / fall-back yields exactly the next calendar day,
 *  not 23 or 25 hours later. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
