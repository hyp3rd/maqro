import type { DietPreference, Food } from "@/components/macro/types";
import { foodDatabase } from "@/data/food-database";
import { filterByDiet } from "@/lib/diet";

/** Build the diet-filtered seed catalog the AI agent sees in its
 *  system prompt. Same shape across `/api/meal-plan`,
 *  `/api/recipes/generate`, and `/api/identify-meal` — third caller
 *  triggers the abstraction per AGENTS.md §1.5.
 *
 *  Returns `null` when the diet preference filters every food away
 *  (the caller should surface a 400 with a "add custom foods"
 *  message). */
export function buildSeedCatalog(
  dietPreference: DietPreference,
  customFoods: Food[] | undefined,
): Food[] | null {
  const seed = filterByDiet(
    [...foodDatabase, ...(customFoods ?? [])],
    dietPreference,
  );
  return seed.length === 0 ? null : seed;
}

/** Build the *resolution* catalog used post-AI to look up the
 *  per-100g macros for each food the model named. Same as the seed
 *  plus everything the agent pulled from Open Food Facts during this
 *  run, with one extra defense-in-depth pass dropping anything whose
 *  name contains a registered allergen substring. */
export function buildResolutionCatalog(
  seed: Food[],
  offFoods: Food[],
  allergies: string[],
): Food[] {
  let c = [...seed, ...offFoods];
  if (allergies.length > 0) {
    c = c.filter((f) => {
      const name = f.name.toLowerCase();
      return !allergies.some((a) => a.length > 0 && name.includes(a));
    });
  }
  return c;
}
