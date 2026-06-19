import { addDays } from "./date";
import { scaleSubMacros } from "./macros";
import type { DailyLog } from "./records";
import type { Food, FoodItem } from "./types";

/** Ranking for the quick-add list: most-recently-logged first, or
 *  most-frequently-logged first (your staples). */
export type RecentSort = "recent" | "frequent";

/** A food the user has logged recently, reconstructed so it can be
 *  re-added in one tap at its last portion. */
export type RecentFood = {
  /** Verbatim display name (from the most recent occurrence). */
  name: string;
  /** Addable per-100g food — feeds the same `logFoodToMeal` path a
   *  search pick does, so re-adds scale + draw down the pantry identically. */
  food: Food;
  /** The portion (grams) the user last logged this food at. */
  lastPortion: number;
  /** Most recent date (YYYY-MM-DD) it was logged — the recency sort key. */
  lastDate: string;
  /** How many times it appears in the window (for a "×N" hint). */
  count: number;
  /** Set by `recentLoggedFoodsForSlot` on rows that came from the GLOBAL
   *  recents backfill rather than this slot's own history — so the UI can
   *  mark them ("from your day" vs "you usually have this here"). Absent on
   *  slot-native rows and on the global `recentLoggedFoods` list. */
  fromOtherSlot?: boolean;
};

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 12;
/** Below this many slot-native recents, `recentLoggedFoodsForSlot` backfills
 *  from the global list (a brand-new user, or a renamed slot whose history is
 *  orphaned, would otherwise show an empty / near-empty strip). */
const DEFAULT_SLOT_BACKFILL_BELOW = 3;

/** Round to ≤1 decimal — the precision the rest of the macro math uses. */
function round1(v: number): number {
  return Number.parseFloat(v.toFixed(1));
}

/** Reconstruct an addable per-100g `Food` from a logged item. The 4 main macros
 *  come from the frozen `originalValues` snapshot when present (exact), else
 *  they're divided back out of the scaled values by the portion. The
 *  MacroBreakdown sub-macros are ALWAYS divided back out of the scaled top-level
 *  values (via the shared `scaleSubMacros`) — `originalValues` only ever
 *  captured the 4 mains, so reading the sub-macros from it silently dropped
 *  the breakdown on re-add. */
function foodFromLoggedItem(item: FoodItem): Food {
  const ov = item.originalValues;
  // Guard the divide so a zero portion can never produce NaN/Infinity.
  const per100 = item.portionSize > 0 ? 100 / item.portionSize : 1;
  return {
    name: item.name.trim(),
    // Re-mint the OFF id so a quick re-add re-captures `offCode` through
    // the same logFoodToMeal path a fresh search pick takes — exact-product
    // provenance survives the recents round-trip.
    id: item.offCode ? `off:${item.offCode}` : undefined,
    protein: ov ? ov.proteinPer100g : round1(item.protein * per100),
    carbs: ov ? ov.carbsPer100g : round1(item.carbs * per100),
    fat: ov ? ov.fatPer100g : round1(item.fat * per100),
    calories: ov ? ov.caloriesPer100g : round1(item.calories * per100),
    micronutrients: item.micronutrients,
    ...scaleSubMacros(item, per100),
  };
}

/** The user's recently-logged foods, de-duplicated by name and ranked by
 *  recency (then frequency), ready for one-tap re-adding.
 *
 *  Pure: walks the supplied `logs` with no I/O or clock reads (`todayKey`
 *  is a parameter so tests can time-travel). Tolerates malformed rows by
 *  skipping them — bad data must never break the logger. Each entry's
 *  representative is the *most recent* occurrence, so the re-add uses the
 *  portion + per-100g snapshot the user last chose.
 *
 *  Recency (not frequency) is the primary sort: it's what "log what I just
 *  ate / what I eat" wants, and for an active user the staples are always
 *  recent anyway. */
export function recentLoggedFoods(
  logs: DailyLog[],
  opts: {
    todayKey: string;
    windowDays?: number;
    limit?: number;
    sort?: RecentSort;
    /** When set, only count foods logged to a meal slot whose name matches
     *  (case-insensitive) — the basis for `recentLoggedFoodsForSlot`. */
    slot?: string;
  },
): RecentFood[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sort = opts.sort ?? "recent";
  const cutoff = addDays(opts.todayKey, -windowDays);
  const slot = opts.slot?.trim().toLowerCase();

  type Acc = { name: string; item: FoodItem; lastDate: string; count: number };
  const byName = new Map<string, Acc>();

  for (const log of logs) {
    if (!log || typeof log.date !== "string") continue;
    // Window: within the last `windowDays`, never future-dated (meal
    // plans for upcoming days aren't "things you ate").
    if (log.date < cutoff || log.date > opts.todayKey) continue;
    if (!Array.isArray(log.meals)) continue;
    for (const meal of log.meals) {
      if (!meal || !Array.isArray(meal.foods)) continue;
      // Slot scoping: skip meals whose name doesn't match the target slot.
      if (slot && (meal.name ?? "").trim().toLowerCase() !== slot) continue;
      for (const food of meal.foods) {
        if (!food || typeof food.name !== "string") continue;
        if (!(food.calories > 0)) continue; // skip blanks / placeholders
        const name = food.name.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const existing = byName.get(key);
        if (!existing) {
          byName.set(key, { name, item: food, lastDate: log.date, count: 1 });
        } else {
          existing.count += 1;
          if (log.date > existing.lastDate) {
            existing.lastDate = log.date;
            existing.item = food;
            existing.name = name;
          }
        }
      }
    }
  }

  return Array.from(byName.values())
    .sort((a, b) => {
      // "frequent" leads with count (staples first); "recent" leads with
      // recency. Both fall back to the other, then name, so the order is
      // stable across reloads.
      if (sort === "frequent") {
        if (b.count !== a.count) return b.count - a.count;
        if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
      } else {
        if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
        if (b.count !== a.count) return b.count - a.count;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((e) => ({
      name: e.name,
      food: foodFromLoggedItem(e.item),
      lastPortion:
        e.item.portionSize > 0 ? Math.round(e.item.portionSize) : 100,
      lastDate: e.lastDate,
      count: e.count,
    }));
}

/** The "Log this again" list for ONE meal slot: the foods most recently logged
 *  to that slot (recency-primary, frequency as tiebreak), ready for one-tap
 *  re-adding at their last portion — the dominant "I eat the same thing for
 *  breakfast" path, in two taps without opening search.
 *
 *  Scoped by meal-slot NAME (the stable handle, like `pastMealsForSlot` and the
 *  schedule matcher), so it survives slot-id churn from template edits. When a
 *  slot has fewer than `backfillBelow` of its own recents (a new user, or a
 *  renamed slot whose history is orphaned), it backfills from the GLOBAL recents
 *  — those rows are flagged `fromOtherSlot` so the UI can label them and the
 *  strip is never awkwardly empty. Pure + defensive, like `recentLoggedFoods`. */
export function recentLoggedFoodsForSlot(
  logs: DailyLog[],
  slotName: string,
  opts: {
    todayKey: string;
    windowDays?: number;
    limit?: number;
    backfillBelow?: number;
  },
): RecentFood[] {
  const slot = slotName.trim().toLowerCase();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const backfillBelow = opts.backfillBelow ?? DEFAULT_SLOT_BACKFILL_BELOW;
  const base = { todayKey: opts.todayKey, windowDays: opts.windowDays, limit };
  // Recency-primary by design (no `sort` passed → `recentLoggedFoods` default).
  const native = slot
    ? recentLoggedFoods(logs, { ...base, slot })
    : recentLoggedFoods(logs, base);
  if (!slot || native.length >= backfillBelow) return native;

  // Sparse slot → top up from the global list, excluding names already shown,
  // marking the additions so the UI can distinguish "from your day" rows.
  const seen = new Set(native.map((r) => r.name.toLowerCase()));
  const backfill = recentLoggedFoods(logs, base)
    .filter((r) => !seen.has(r.name.toLowerCase()))
    .map((r) => ({ ...r, fromOtherSlot: true }));
  return [...native, ...backfill].slice(0, limit);
}

/** A previous day's instance of a meal slot — for "copy a previous Dinner". */
export type PastMeal = {
  /** YYYY-MM-DD it was logged. */
  date: string;
  /** Foods exactly as logged (with portions), so they re-add verbatim. */
  foods: FoodItem[];
  totalKcal: number;
};

const DEFAULT_PAST_MEAL_LIMIT = 7;

/** Past instances of a meal SLOT (matched by name) that had foods — backing
 *  the "copy a previous {slot}" action. Excludes today and future days,
 *  newest first. Pure + defensive, like `recentLoggedFoods`. */
export function pastMealsForSlot(
  logs: DailyLog[],
  slotName: string,
  opts: { todayKey: string; windowDays?: number; limit?: number },
): PastMeal[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = opts.limit ?? DEFAULT_PAST_MEAL_LIMIT;
  const cutoff = addDays(opts.todayKey, -windowDays);
  const slot = slotName.trim().toLowerCase();
  if (!slot) return [];

  const out: PastMeal[] = [];
  for (const log of logs) {
    if (!log || typeof log.date !== "string") continue;
    if (log.date >= opts.todayKey || log.date < cutoff) continue; // past only
    if (!Array.isArray(log.meals)) continue;
    const meal = log.meals.find(
      (m) =>
        m &&
        typeof m.name === "string" &&
        m.name.trim().toLowerCase() === slot &&
        Array.isArray(m.foods),
    );
    if (!meal) continue;
    const foods = meal.foods.filter((f) => f && f.calories > 0);
    if (foods.length === 0) continue;
    out.push({
      date: log.date,
      foods,
      totalKcal: Math.round(foods.reduce((s, f) => s + f.calories, 0)),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out.slice(0, limit);
}
