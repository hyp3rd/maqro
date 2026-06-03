import type { Food, FoodItem, MacroBreakdown } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";

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
};

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 12;

/** Round to ≤1 decimal — the precision the rest of the macro math uses. */
function round1(v: number): number {
  return Number.parseFloat(v.toFixed(1));
}

/** Copy the optional sub-macros, scaling each present value (×1 when the
 *  source is already per-100g, ×ratio when dividing a scaled item back
 *  out). Explicit per field so the result is a clean `MacroBreakdown`
 *  with no stray keys. */
function subMacros(src: MacroBreakdown, scale: number): MacroBreakdown {
  const out: MacroBreakdown = {};
  if (typeof src.sugars === "number") out.sugars = round1(src.sugars * scale);
  if (typeof src.addedSugars === "number")
    out.addedSugars = round1(src.addedSugars * scale);
  if (typeof src.fiber === "number") out.fiber = round1(src.fiber * scale);
  if (typeof src.saturatedFat === "number")
    out.saturatedFat = round1(src.saturatedFat * scale);
  if (typeof src.transFat === "number")
    out.transFat = round1(src.transFat * scale);
  if (typeof src.monoFat === "number")
    out.monoFat = round1(src.monoFat * scale);
  if (typeof src.polyFat === "number")
    out.polyFat = round1(src.polyFat * scale);
  return out;
}

/** Reconstruct an addable per-100g `Food` from a logged item. Prefer the
 *  frozen `originalValues` snapshot (already per-100g); for legacy rows
 *  without it, divide the scaled values back out by the portion. */
function foodFromLoggedItem(item: FoodItem): Food {
  const ov = item.originalValues;
  if (ov) {
    return {
      name: item.name.trim(),
      protein: ov.proteinPer100g,
      carbs: ov.carbsPer100g,
      fat: ov.fatPer100g,
      calories: ov.caloriesPer100g,
      micronutrients: item.micronutrients,
      ...subMacros(ov, 1),
    };
  }
  // No snapshot: back the per-100g values out of the scaled ones. Guard
  // the divide so a zero portion can never produce NaN/Infinity.
  const ratio = item.portionSize > 0 ? 100 / item.portionSize : 1;
  return {
    name: item.name.trim(),
    protein: round1(item.protein * ratio),
    carbs: round1(item.carbs * ratio),
    fat: round1(item.fat * ratio),
    calories: round1(item.calories * ratio),
    micronutrients: item.micronutrients,
    ...subMacros(item, ratio),
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
  },
): RecentFood[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sort = opts.sort ?? "recent";
  const cutoff = dateMinusDays(opts.todayKey, windowDays);

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
  const cutoff = dateMinusDays(opts.todayKey, windowDays);
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

/** YYYY-MM-DD calendar arithmetic — treat the key as a date marker, not a
 *  timestamp, so DST/timezone can't move the cutoff. Mirrors the helper in
 *  [lib/personalization/preferences.ts](./personalization/preferences.ts). */
function dateMinusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  const yy = dt.getFullYear();
  const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
