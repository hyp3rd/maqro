import { scaleSubMacros } from "./macros";
import { offCodeFromFoodId } from "./off";
import type { Food, FoodItem } from "./types";

/** The portion-scaled fields of a logged food — everything `logFoodToMeal`
 *  derives purely from `(food, grams)`. The stateful fields it adds on top
 *  (`id`, `pantrySource`, `loggedAt`) and the form-only `selectedMealId` are
 *  excluded so this stays a pure, unit-testable transform. */
export type ScaledFoodFields = Omit<
  FoodItem,
  "id" | "pantrySource" | "loggedAt" | "selectedMealId"
>;

/** Turn a per-100g `Food` into the portion-scaled fields of a meal `FoodItem`.
 *
 *  The ONE place the per-100g → portion contract lives. Both the mobile/search
 *  path and the desktop inline form funnel through here, so a food logged from
 *  either surface is byte-identical:
 *    - main macros scale by `grams/100`, rounded the canonical way (1dp for
 *      P/C/F, integer kcal);
 *    - sub-macros (`scaleSubMacros`) are stored PRE-scaled to the portion;
 *    - micronutrients pass through UNSCALED (the aggregator scales by
 *      `portion/100` itself — same convention as the name-keyed profile cache);
 *    - `offCode` is the exact-product provenance for the enrichment cron;
 *    - `originalValues` snapshots the RAW per-100g basis so a later portion
 *      edit re-scales without re-resolving the source food.
 *
 *  Pure: no `Date.now()`, no React/IDB state. */
export function scaleFoodToItem(food: Food, grams: number): ScaledFoodFields {
  const ratio = grams / 100;
  return {
    name: food.name,
    protein: Number.parseFloat((food.protein * ratio).toFixed(1)),
    carbs: Number.parseFloat((food.carbs * ratio).toFixed(1)),
    fat: Number.parseFloat((food.fat * ratio).toFixed(1)),
    calories: Math.round(food.calories * ratio),
    portionSize: grams,
    ...scaleSubMacros(food, ratio),
    micronutrients: food.micronutrients,
    offCode: offCodeFromFoodId(food.id),
    originalValues: {
      proteinPer100g: food.protein,
      carbsPer100g: food.carbs,
      fatPer100g: food.fat,
      caloriesPer100g: food.calories,
    },
  };
}

/** Resolve the per-100g `Food` to log from the desktop inline add form's state,
 *  so the desktop add routes through the SAME `logFoodToMeal(food, grams)` path
 *  as mobile/search instead of a parallel, lossy handler.
 *
 *  The form holds two things: the picked catalog food (`selectedFood`, per-100g,
 *  full precision + provenance) and the portion-scaled values shown in the macro
 *  grid (`scaled`, which the user can manually edit).
 *
 *    - Picked food, macros UNTOUCHED → return `selectedFood` verbatim (only the
 *      name overridden, since the search box is editable). The logged item is
 *      then identical to the mobile path — full precision, sub-macros, micros,
 *      offCode — with NO lossy "scale → round → divide back" round-trip.
 *    - Manual macro override, OR a hand-typed food with no pick → fold the
 *      portion-scaled values back to per-100g and DROP catalog provenance
 *      (id/source/sub-macros/micros): the numbers no longer match the source
 *      product, so carrying its offCode/micros would mislabel the entry.
 *
 *  "Untouched" is detected by recomputing the expected scaled values with the
 *  EXACT rounding the form uses (`handleFoodSelect` / `handlePortionChange`),
 *  so an unedited food compares equal deterministically. Pure. */
export function addFoodBasis(
  selectedFood: Food | null,
  scaled: { protein: number; carbs: number; fat: number; calories: number },
  name: string,
  grams: number,
): Food {
  const ratio = grams / 100;
  if (selectedFood && ratio > 0) {
    const expProtein = Number.parseFloat(
      (selectedFood.protein * ratio).toFixed(1),
    );
    const expCarbs = Number.parseFloat((selectedFood.carbs * ratio).toFixed(1));
    const expFat = Number.parseFloat((selectedFood.fat * ratio).toFixed(1));
    const expCalories = Math.round(selectedFood.calories * ratio);
    const untouched =
      scaled.protein === expProtein &&
      scaled.carbs === expCarbs &&
      scaled.fat === expFat &&
      scaled.calories === expCalories;
    if (untouched) return { ...selectedFood, name };
  }
  // Manual override or fully-manual entry: reconstruct the per-100g basis from
  // the user's portion-scaled values. This divide-back is unavoidable here —
  // there is no higher-precision source — but it now happens ONLY on this path,
  // not (as before) for untouched picks that had full precision available.
  const inv = ratio > 0 ? 1 / ratio : 0;
  return {
    name,
    protein: scaled.protein * inv,
    carbs: scaled.carbs * inv,
    fat: scaled.fat * inv,
    calories: scaled.calories * inv,
  };
}
