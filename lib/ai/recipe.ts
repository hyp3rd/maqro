import type {
  Food,
  FoodKind,
  Recipe,
  RecipeIngredient,
} from "@/components/macro/types";
import { classifyFood } from "@/lib/diet";
import { buildNormIndex, matchPick } from "./plan";

/** Shape submitted by the AI's `submit_recipe` tool call. The model picks
 *  food names + portions; macros are computed deterministically from the
 *  resolved catalog snapshot — the model never invents nutrient values. */
export type AiRecipeSubmit = {
  name: string;
  ingredients: Array<{ name: string; portionGrams: number }>;
  cuisine?: string;
  notes?: string;
};

const PORTION_MIN = 5;
const PORTION_MAX = 500;
const PORTION_SNAP = 5;
const NAME_MAX = 80;
const NOTES_MAX = 500;

function clampPortion(grams: number): number {
  if (!Number.isFinite(grams)) return PORTION_MIN;
  const snapped = Math.round(grams / PORTION_SNAP) * PORTION_SNAP;
  return Math.max(PORTION_MIN, Math.min(PORTION_MAX, snapped));
}

function deriveKind(food: Food): FoodKind | undefined {
  if (food.dietKind) return food.dietKind;
  const k = classifyFood(food);
  return k === "unknown" ? undefined : k;
}

function snapshotIngredient(
  food: Food,
  portionGrams: number,
): RecipeIngredient {
  return {
    foodName: food.name,
    macrosPer100g: {
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      calories: food.calories,
    },
    portionGrams: clampPortion(portionGrams),
    dietKind: deriveKind(food),
  };
}

/** Convert an AI `submit_recipe` payload into the persisted Recipe shape.
 *  Mirrors `aiPlanToMeals` from plan.ts:
 *    - normalizes + matches by name (exact then word-boundary substring)
 *    - silently drops ingredients that don't resolve (no invented macros)
 *    - clamps portion to [5, 500] g on a 5 g grid
 *    - tolerates malformed AI output (missing fields, wrong types)
 *  Returns the recipe minus id/createdAt/updatedAt — the caller (route or
 *  client save flow) fills those in. */
export function resolveAiRecipe(
  submit: AiRecipeSubmit,
  catalog: Food[],
  fallbackName: string = "Generated recipe",
): Omit<Recipe, "id" | "createdAt" | "updatedAt"> {
  const byNorm = buildNormIndex(catalog);
  const aiIngredients = Array.isArray(submit?.ingredients)
    ? submit.ingredients
    : [];

  const ingredients: RecipeIngredient[] = [];
  for (const pick of aiIngredients) {
    if (!pick || typeof pick.name !== "string") continue;
    const food = matchPick(pick.name, catalog, byNorm);
    if (!food) continue;
    const grams =
      typeof pick.portionGrams === "number" ? pick.portionGrams : 100;
    ingredients.push(snapshotIngredient(food, grams));
  }

  const rawName = typeof submit?.name === "string" ? submit.name.trim() : "";
  const name = (rawName || fallbackName).slice(0, NAME_MAX);
  const rawNotes = typeof submit?.notes === "string" ? submit.notes.trim() : "";
  const notes = rawNotes ? rawNotes.slice(0, NOTES_MAX) : undefined;
  const rawCuisine =
    typeof submit?.cuisine === "string" ? submit.cuisine.trim() : "";
  const cuisine = rawCuisine || undefined;

  return { name, ingredients, cuisine, notes };
}

/** Return the AI's submitted ingredient names that won't resolve against
 *  the catalog. Used by the route to feed a validation error back to the
 *  model so it can correct names within the iteration budget rather than
 *  failing the recipe with empty-ingredients. */
export function unmatchedIngredientNames(
  submit: AiRecipeSubmit,
  catalog: Food[],
): string[] {
  const byNorm = buildNormIndex(catalog);
  const ais = Array.isArray(submit?.ingredients) ? submit.ingredients : [];
  const out: string[] = [];
  for (const pick of ais) {
    if (!pick || typeof pick.name !== "string") continue;
    if (!matchPick(pick.name, catalog, byNorm)) out.push(pick.name);
  }
  return out;
}
