import type { RecipeIngredient } from "@/components/macro/types";

/** Allowed serving-scale range for recipe apply. ¼ serving handles
 *  "I want one portion of a 4-person recipe"; 10× covers the
 *  "cooking for a small army / weekly meal-prep" upper bound. The
 *  UI clamps to this range before calling the helper, but the
 *  helper clamps too so a bad fetch / URL-shared draft can't ship
 *  an absurd portion. */
export const MIN_RECIPE_SCALE = 0.25;
export const MAX_RECIPE_SCALE = 10;

/** Scale a recipe's ingredients by a multiplier. Only `portionGrams`
 *  changes — `macrosPer100g` is, by definition, a per-100g constant,
 *  so the per-ingredient absolute macros computed at apply time
 *  (`portionGrams / 100 × per100g`) naturally scale too.
 *
 *  Portion math rounds to the nearest gram. We don't snap to 5 g
 *  here because the source recipe may already have non-multiples-of-
 *  five (custom-entered, AI-generated) and we'd rather preserve
 *  precision than impose grid alignment after the fact. The user
 *  can edit each portion in the slot UI if they want round numbers.
 *
 *  A scale of `1` short-circuits to return the input array
 *  unchanged — saves a map() + object spread for the common case
 *  (the dialogs default to 1× serving). */
export function scaleRecipeIngredients(
  ingredients: readonly RecipeIngredient[],
  scale: number,
): RecipeIngredient[] {
  const clamped = clampScale(scale);
  if (clamped === 1) return [...ingredients];
  return ingredients.map((ing) => ({
    ...ing,
    portionGrams: Math.max(1, Math.round(ing.portionGrams * clamped)),
  }));
}

/** Clamp a user-supplied scale to the documented range. NaN /
 *  non-finite inputs fall back to 1× so a stray empty-string state
 *  doesn't blow away the recipe. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  if (scale < MIN_RECIPE_SCALE) return MIN_RECIPE_SCALE;
  if (scale > MAX_RECIPE_SCALE) return MAX_RECIPE_SCALE;
  return scale;
}

/** Format a scale value for the stepper label. Integer multiples
 *  drop the decimal ("2×" not "2.0×"); halves and quarters keep
 *  one or two places so "0.25×", "0.5×", "1.5×" all read cleanly. */
export function formatScale(scale: number): string {
  if (Number.isInteger(scale)) return `${scale}×`;
  // Up to 2 decimals, no trailing zeros beyond what's needed.
  const rounded = Math.round(scale * 100) / 100;
  return `${rounded}×`;
}
