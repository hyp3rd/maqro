import type { Food } from "@maqro/core/types";

/** Display label for each food source, shown as a badge in the add-food search
 *  lists. One definition shared by every search surface (was duplicated
 *  verbatim in FoodSearchSheet + AddFoodForm). */
export const SOURCE_LABEL: Record<NonNullable<Food["source"]>, string> = {
  builtin: "Built-in",
  custom: "My food",
  off: "Open Food Facts",
  ciqual: "CIQUAL",
};

/** Default portion (grams) for a one-tap add before the user picks a size. */
export const DEFAULT_GRAMS = 100;

/** Quick portion presets offered in the inline portion editor. */
export const PORTION_PRESETS = [50, 100, 150, 200] as const;

/** The canonical "food added" confirmation toast — ONE wording across every
 *  add surface (the full-screen search sheet, the guided quick-add list, the
 *  desktop inline form, and barcode scan) so feedback reads identically no
 *  matter which door the user came through. */
export function addedFoodMessage(
  name: string,
  grams: number,
  kcal: number,
  mealName: string,
): string {
  return `Added ${name} (${grams} g, ${kcal} kcal) to ${mealName}`;
}
