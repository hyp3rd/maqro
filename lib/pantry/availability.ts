import type { Recipe } from "@/components/macro/types";
import type { PantryItem } from "@/lib/db";
import { consumedUnitAmount, matchPantryItem } from "@/lib/pantry/consume";

export type IngredientShortfall = {
  name: string;
  /** Grams this cook needs (already scaled). */
  neededGrams: number;
  /** "missing" = no matching pantry item at all; "low" = matched but not
   *  enough on hand to cover this cook. */
  kind: "missing" | "low";
};

/** Ingredients the pantry can't cover for one cook of `recipe` (scaled by
 *  `scale`). Name matching + unit conversion reuse the pantry-consume engine,
 *  so this agrees with what a "Log it" draw-down would actually subtract.
 *
 *  Per-ingredient (no running balance), so a recipe that uses the same item on
 *  two lines is checked against the full quantity for each line, not the sum.
 *  That's fine for an advisory "are you stocked" check. Count / free-text units
 *  (eggs, cans) are considered covered when at least one is on hand. */
export function recipeShortfalls(
  recipe: Recipe,
  pantry: PantryItem[],
  scale = 1,
): IngredientShortfall[] {
  const out: IngredientShortfall[] = [];
  for (const ing of recipe.ingredients) {
    const grams = ing.portionGrams * scale;
    const item = matchPantryItem(ing.foodName, pantry);
    if (!item) {
      out.push({ name: ing.foodName, neededGrams: grams, kind: "missing" });
      continue;
    }
    const need = consumedUnitAmount(item.unit, grams, 1, item.density);
    if (item.quantity < need) {
      out.push({ name: ing.foodName, neededGrams: grams, kind: "low" });
    }
  }
  return out;
}
