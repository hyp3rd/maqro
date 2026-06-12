import type { DailyLog } from "@/lib/db";
import { addDays } from "@maqro/core/date";

/** One food + how often the user has eaten it in the lookback
 *  window. `name` is the verbatim string the user logged — that's
 *  what the AI prompt biases on (it's the same string the
 *  matcher used downstream, so the round-trip stays clean). */
export interface FoodPreference {
  name: string;
  count: number;
}

export interface ExtractPreferencesOpts {
  /** Today's `YYYY-MM-DD` key. Logs older than `windowDays` days
   *  from this date are ignored. Taking `todayKey` as a parameter
   *  (not via `new Date()`) keeps the function pure so tests can
   *  time-travel without `vi.setSystemTime`. */
  todayKey: string;
  /** How far back to look. 30 days is the sweet spot:
   *
   *    - Long enough to capture the user's actual rotation
   *      (most people cook on a ~2-week cycle, so 30 days sees
   *      almost everything twice).
   *    - Short enough that a one-off "I tried this exotic recipe
   *      once" doesn't get reinforced into next month's plan.
   *
   *  Adjust at the callsite if a specific surface wants a
   *  different horizon. */
  windowDays?: number;
  /** Cap on returned items. The AI prompt has a token budget;
   *  more than ~30 foods drowns out the other constraints. */
  topN?: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_TOP_N = 30;

/** Extract the user's most-eaten foods within a recent window.
 *
 *  Pure function: walks the supplied `logs` (no I/O, no clock
 *  reads, no global state), counts how often each food name
 *  appears, returns the top-N sorted by count desc. Foods that
 *  appear only once are still returned — they signal "this is in
 *  the user's universe at all", which is useful context even
 *  without high frequency.
 *
 *  Why food NAMES (not catalog ids): the AI prompt sees foods as
 *  strings. The downstream matcher in `lib/ai/plan.ts#matchPick`
 *  normalizes names back to catalog entries — same path the
 *  identify-meal and voice-log routes use. Passing names keeps
 *  preferences usable across built-in / custom / OFF foods
 *  uniformly, with no per-source plumbing.
 *
 *  The function tolerates malformed log entries (missing meals,
 *  missing foods array, missing names) by skipping them rather
 *  than throwing — bad data should never break plan generation. */
export function extractFoodPreferences(
  logs: DailyLog[],
  opts: ExtractPreferencesOpts,
): FoodPreference[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const cutoff = addDays(opts.todayKey, -windowDays);

  const counts = new Map<string, number>();
  for (const log of logs) {
    if (!log || typeof log.date !== "string") continue;
    if (log.date < cutoff) continue;
    if (!Array.isArray(log.meals)) continue;
    for (const meal of log.meals) {
      if (!meal || !Array.isArray(meal.foods)) continue;
      for (const food of meal.foods) {
        if (!food || typeof food.name !== "string") continue;
        const name = food.name.trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      // Stable secondary sort: alphabetical. Two foods at the same
      // count shouldn't shuffle between requests — the AI is
      // sensitive to prompt order, and a deterministic tiebreak
      // makes the cache key (the system prompt prefix) stable.
      return a.name.localeCompare(b.name);
    })
    .slice(0, topN);
}
