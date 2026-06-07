/** Expand a saved recipe's ingredients into per-portion `FoodItem`s ready to log
 *  into a meal slot. (This module also held the multi-day "cook for the week"
 *  batch helpers; that flow became the scheduler — see the Recipes Scheduled
 *  list — so only the ingredient-to-food mapper remains.) */
import type { FoodItem, RecipeIngredient } from "@/components/macro/types";

/** Expand one recipe ingredient into a per-portion `FoodItem` ready to log:
 *  scales the per-100g macros by `portionGrams / 100`, carries the recipe's
 *  frozen per-100g micronutrients (the aggregator scales by portion later), and
 *  stamps `originalValues` so the slot UI can re-edit the portion. `id` is
 *  caller-supplied so a multi-slot apply keeps its FoodItem ids collision-free
 *  for dnd-kit keys. */
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
