import type { Recipe } from "@/components/macro/types";

/** Macro budget for a single meal slot. The caller (typically the
 *  meal planner UI) derives this by dividing the day's macro target
 *  by the number of slots — see {@link computeSlotBudget}.
 *
 *  Calories are NOT used in the fit score: protein/carbs/fat already
 *  determine calories deterministically, and weighting kcal on top
 *  would double-count whichever macro happens to dominate. */
export interface SlotBudget {
  protein: number;
  carbs: number;
  fat: number;
}

/** Per-serving macros of a recipe. Computed from the per-ingredient
 *  snapshot × portion, then divided by `servings ?? 1`. This is the
 *  unit a "fits the slot" judgement makes sense in: applying a
 *  recipe with `servings: 4` to a single meal usually means eating
 *  one quarter of it. */
export interface RecipeMacros {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export interface RankedRecipe {
  recipe: Recipe;
  /** Per-serving macros — same shape as the slot budget so the UI can
   *  show "300 kcal · P30" next to a fit badge without re-deriving. */
  perServing: RecipeMacros;
  /** Lower is better. Sum of |per-serving − budget| / budget across
   *  protein, carbs, fat. Each component is capped at 2.0 so one
   *  wildly-off macro can't drown out the others. A perfect fit is
   *  0; a recipe twice the size on every macro is 3. Undefined when
   *  the budget has all-zero macros (no daily target set yet) — the
   *  UI falls back to the original order in that case. */
  fitScore: number | undefined;
}

/** Per-serving total of a recipe. Pure function over the snapshot
 *  macros; doesn't touch the live catalog because recipe ingredients
 *  carry their own `macrosPer100g` at save time (the source food
 *  could be renamed/deleted; the recipe's macros should still be
 *  stable). */
export function recipePerServingMacros(recipe: Recipe): RecipeMacros {
  const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let calories = 0;
  for (const ing of recipe.ingredients) {
    const factor = ing.portionGrams / 100;
    protein += ing.macrosPer100g.protein * factor;
    carbs += ing.macrosPer100g.carbs * factor;
    fat += ing.macrosPer100g.fat * factor;
    calories += ing.macrosPer100g.calories * factor;
  }
  return {
    protein: protein / servings,
    carbs: carbs / servings,
    fat: fat / servings,
    calories: calories / servings,
  };
}

/** Divide a day's macro target evenly across meal slots, returning a
 *  per-slot budget. Callers pass `slots` = total number of meal
 *  slots in the day (typically `meals.length`); this stays constant
 *  whether the slots are populated or not, so the budget is stable
 *  while the user fills slots one at a time. Returns zeros when
 *  `slots <= 0` so the caller doesn't need to guard. */
export function computeSlotBudget(
  dailyTarget: SlotBudget,
  slots: number,
): SlotBudget {
  if (slots <= 0) {
    return { protein: 0, carbs: 0, fat: 0 };
  }
  return {
    protein: dailyTarget.protein / slots,
    carbs: dailyTarget.carbs / slots,
    fat: dailyTarget.fat / slots,
  };
}

const COMPONENT_CAP = 2.0;

/** Rank recipes by how close their per-serving macros come to the
 *  slot budget. Lower score = better fit. When `budget` is missing
 *  or all-zero (user hasn't entered a target yet, or `slots` was 0),
 *  the score is `undefined` and recipes return in their original
 *  order — never imposing a meaningless ranking on a zero signal. */
export function rankRecipesByFit(
  recipes: Recipe[],
  budget: SlotBudget | undefined,
): RankedRecipe[] {
  const ranked: RankedRecipe[] = recipes.map((recipe) => ({
    recipe,
    perServing: recipePerServingMacros(recipe),
    fitScore: undefined,
  }));
  if (!budget) return ranked;
  const usable =
    budget.protein > 0 || budget.carbs > 0 || budget.fat > 0
      ? budget
      : undefined;
  if (!usable) return ranked;

  for (const entry of ranked) {
    entry.fitScore = fitScore(entry.perServing, usable);
  }
  // Stable sort: ties keep their original order. Recipes without a
  // score (shouldn't happen once usable is set, but typed defensively)
  // sink to the bottom.
  ranked.sort((a, b) => {
    const sa = a.fitScore ?? Number.POSITIVE_INFINITY;
    const sb = b.fitScore ?? Number.POSITIVE_INFINITY;
    return sa - sb;
  });
  return ranked;
}

function fitScore(actual: RecipeMacros, budget: SlotBudget): number {
  let score = 0;
  for (const macro of ["protein", "carbs", "fat"] as const) {
    const b = budget[macro];
    if (b <= 0) continue; // skip zero-budget macros entirely
    const delta = Math.abs(actual[macro] - b) / b;
    score += Math.min(delta, COMPONENT_CAP);
  }
  return score;
}
