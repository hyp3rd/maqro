import type {
  FoodItem,
  Recipe,
  RecipeIngredient,
} from "@/components/macro/types";
import type { MealTemplate } from "@/lib/db";

/** Shape we hand back to `addRecipe` — same as `RecipeDraft` but
 *  re-declared here so this lib doesn't import from RecipeForm and
 *  pull React into a pure module. */
export type RecipeDraftFromTemplate = Omit<
  Recipe,
  "id" | "createdAt" | "updatedAt" | "shareSlug" | "shareVisibility"
>;

/** Derive per-100g macros from a single FoodItem.
 *
 *  Preferred source: `food.originalValues`, captured when the food
 *  was added to the meal. When it's missing (older logs predating
 *  that field, or a hand-entered food), back it out from the
 *  absolute macros + portionSize so the recipe still saves with
 *  the macros the user is looking at. A zero portionSize falls back
 *  to the absolute numbers — uncommon but defensive against a
 *  divide-by-zero. */
function macrosPer100gFromFood(
  food: FoodItem,
): RecipeIngredient["macrosPer100g"] {
  if (food.originalValues) {
    return {
      protein: food.originalValues.proteinPer100g,
      carbs: food.originalValues.carbsPer100g,
      fat: food.originalValues.fatPer100g,
      calories: food.originalValues.caloriesPer100g,
    };
  }
  if (!food.portionSize || food.portionSize <= 0) {
    return {
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      calories: food.calories,
    };
  }
  const k = 100 / food.portionSize;
  return {
    protein: Math.round(food.protein * k * 10) / 10,
    carbs: Math.round(food.carbs * k * 10) / 10,
    fat: Math.round(food.fat * k * 10) / 10,
    calories: Math.round(food.calories * k),
  };
}

/** Convert a saved meal template into a recipe draft. The user is
 *  expected to optionally edit `cuisine` / `notes` afterwards from
 *  the Recipes view — we don't try to guess either from the template
 *  name. Empty templates (no foods) are still allowed; the resulting
 *  recipe simply has no ingredients and the user can add some
 *  before saving manually.
 *
 *  The function is pure so the conversion is testable without
 *  spinning up IDB. Caller decides whether to hand the draft
 *  straight to `addRecipe` (one-click convert) or pre-fill an open
 *  RecipeForm (review-before-save flow). */
export function templateToRecipeDraft(
  template: MealTemplate,
): RecipeDraftFromTemplate {
  return {
    name: template.name,
    ingredients: template.foods.map((food) => ({
      foodName: food.name,
      portionGrams: food.portionSize,
      macrosPer100g: macrosPer100gFromFood(food),
      // dietKind isn't stored on FoodItem (lives on CustomFood). We
      // leave it undefined and let `recipeDietCompatibility` treat
      // the recipe as "unknown diet" → omnivore-only by default.
      // The user can rebuild diet metadata via the recipe edit
      // form if they care.
    })),
  };
}
