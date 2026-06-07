/** Helpers for the meal-prep batch flow ("cook once, log for the
 *  week") — applying a recipe to one named meal slot across N
 *  consecutive days, anchored at today.
 *
 *  The date math is pure (no `new Date()` reads at call time
 *  unless the caller passes `new Date()` themselves). The
 *  IndexedDB write path lives in the calculator alongside the
 *  existing single-slot apply — see `handleApplyRecipe`. */
import type {
  FoodItem,
  Meal,
  RecipeIngredient,
} from "@/components/macro/types";
import { dateKey } from "@/lib/db";

export { todayKey } from "@/lib/db";

/** Expand one recipe ingredient into a per-portion `FoodItem` ready to log:
 *  scales the per-100g macros by `portionGrams / 100`, carries the recipe's
 *  frozen per-100g micronutrients (the aggregator scales by portion later), and
 *  stamps `originalValues` so the slot UI can re-edit the portion. `id` is
 *  caller-supplied so a multi-slot/day apply keeps its FoodItem ids
 *  collision-free for dnd-kit keys. */
export function recipeIngredientToFood(
  ing: RecipeIngredient,
  id: number,
): FoodItem {
  const r = ing.portionGrams / 100;
  return {
    id,
    name: ing.foodName,
    protein: Number.parseFloat((ing.macrosPer100g.protein * r).toFixed(1)),
    carbs: Number.parseFloat((ing.macrosPer100g.carbs * r).toFixed(1)),
    fat: Number.parseFloat((ing.macrosPer100g.fat * r).toFixed(1)),
    calories: Math.round(ing.macrosPer100g.calories * r),
    portionSize: ing.portionGrams,
    micronutrients: ing.micronutrientsPer100g,
    originalValues: {
      proteinPer100g: ing.macrosPer100g.protein,
      carbsPer100g: ing.macrosPer100g.carbs,
      fatPer100g: ing.macrosPer100g.fat,
      caloriesPer100g: ing.macrosPer100g.calories,
    },
  };
}

const MAX_BATCH_DAYS = 7;
const MIN_BATCH_DAYS = 1;

/** Clamp the requested batch day-count to a sensible range. The
 *  upper bound is one week — the UX is "cook for the week", not "log
 *  for the month" — and it matches the ApplyRecipeDialog stepper's
 *  max. */
export function clampBatchDays(n: number): number {
  if (!Number.isFinite(n)) return MIN_BATCH_DAYS;
  if (n < MIN_BATCH_DAYS) return MIN_BATCH_DAYS;
  if (n > MAX_BATCH_DAYS) return MAX_BATCH_DAYS;
  return Math.floor(n);
}

/** The `extraDates` to write to BEYOND today, given a total day
 *  count anchored at today. `today` is taken as a `Date` parameter
 *  so callers can time-travel in tests without `vi.setSystemTime`.
 *
 *  - `totalDays = 1` → `[]` (today-only, the existing single-apply
 *    path)
 *  - `totalDays = 3, today = 2026-05-26` → `["2026-05-27",
 *    "2026-05-28"]`
 *
 *  Returns at most `MAX_BATCH_DAYS - 1` entries because today is
 *  always implicit. */
export function extraDatesFromToday(
  totalDays: number,
  today: Date = new Date(),
): string[] {
  const clamped = clampBatchDays(totalDays);
  if (clamped <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < clamped; i++) {
    const next = new Date(today);
    next.setDate(today.getDate() + i);
    out.push(dateKey(next));
  }
  return out;
}

/** Merge a recipe's pre-cloned ingredients into a day's meals, in
 *  the slot whose `name` matches `slotName` (case-sensitive — slot
 *  names are user-controlled but stable). Returns a new meals array
 *  with the slot's `foods` appended; the rest of the day is
 *  untouched. Pure function.
 *
 *  When the day has no slot with that name (different per-day
 *  template, or the user renamed the slot since this log was
 *  written), the function returns `null` so the caller can decide
 *  what to do — typically skip the day rather than guess. */
export function appendRecipeToNamedSlot<F>(
  meals: Meal[],
  slotName: string,
  foods: F[],
): Meal[] | null {
  const idx = meals.findIndex((m) => m.name === slotName);
  if (idx < 0) return null;
  return meals.map((m, i) =>
    i === idx ? { ...m, foods: [...m.foods, ...(foods as Meal["foods"])] } : m,
  );
}
