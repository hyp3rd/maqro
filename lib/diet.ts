import type {
  DietPreference,
  Food,
  FoodKind,
  Recipe,
} from "@/components/macro/types";

/** What kind of food this is in animal-vs-plant terms. `FoodKind` is the
 * user-facing enum (no "unknown"). The classifier extends it with
 * `"unknown"` for foods that lack both an explicit `dietKind` and any
 * derivable category metadata — those land in the conservative bucket
 * (omnivore-only) so a vegan plan never accidentally pulls in a
 * pangasius fillet imported from an OFF search. */
export type ClassifiedKind = FoodKind | "unknown";

/** Classify a Food. Explicit `dietKind` wins; otherwise we derive from the
 * built-in `category` / `subCategory` tag vocabulary in `data/food-database.ts`.
 * Returns `"unknown"` when neither path produces a hit — typically custom
 * foods saved before this field existed, or OFF imports that haven't been
 * classified yet. */
export function classifyFood(food: Food): ClassifiedKind {
  if (food.dietKind) return food.dietKind;

  const sub = food.subCategory?.toLowerCase() ?? "";
  const cat = food.category?.toLowerCase() ?? "";

  if (sub === "poultry" || sub === "beef" || sub === "pork" || sub === "lamb") {
    return "land-meat";
  }
  if (sub === "fish" || sub === "shellfish" || sub === "seafood") {
    return "seafood";
  }
  if (sub === "egg") return "egg";
  if (cat === "dairy") return "dairy";
  if (sub === "honey") return "honey";

  // Whey-based supplements and "protein" subcategory default to dairy-class
  // (vegetarian-friendly, vegan-excluded). Plant-protein powders use the
  // explicit `plant protein` category instead.
  if (cat === "supplement" || sub === "protein" || sub === "protein bar") {
    return "dairy";
  }
  // Sweets / chocolate / sweeteners (excluding honey) — assume contains
  // dairy by default (milk chocolate). Cleaner-tagged plant-only sweets
  // could be added to the database with `plant protein` style overrides.
  if (cat === "sweet") return "dairy";

  if (
    cat === "fruit" ||
    cat === "vegetable" ||
    cat === "starchy veggie" ||
    cat === "grain" ||
    cat === "legumes" ||
    cat === "plant protein" ||
    cat === "nuts" ||
    cat === "nut butter" ||
    cat === "healthy fat" ||
    cat === "oil"
  ) {
    return "plant";
  }

  return "unknown";
}

/** True if a food is compatible with the user's diet preference.
 *
 * Conservative default for unclassified foods: only omnivore plans accept
 * them. This is intentional — letting an untagged "Pangasius Filets"
 * custom food slip into a vegan plan is worse than asking the user to
 * tag it once in the My Foods view. */
export function isCompatibleWithDiet(
  food: Food,
  diet: DietPreference,
): boolean {
  return isKindCompatibleWithDiet(classifyFood(food), diet);
}

/** Filter a Food[] down to items the user can eat. */
export function filterByDiet(foods: Food[], diet: DietPreference): Food[] {
  return foods.filter((f) => isCompatibleWithDiet(f, diet));
}

const ALL_DIETS: readonly DietPreference[] = [
  "omnivore",
  "vegetarian",
  "vegan",
  "pescatarian",
  "carnivore",
];

/** Which diet preferences a recipe is suitable for, derived from its
 *  ingredients' `dietKind` snapshots. A recipe is suitable for a diet iff
 *  every ingredient is suitable for that diet. An empty-ingredient recipe
 *  returns the full set (vacuously suitable) so the picker doesn't hide a
 *  freshly-created empty draft.
 *
 *  Unlike `isCompatibleWithDiet`, this only consults the snapshot stored
 *  on the recipe — never re-fetches the catalog — so the result is stable
 *  as ingredient sources are edited / deleted elsewhere. */
export function recipeDietCompatibility(recipe: Recipe): Set<DietPreference> {
  const result = new Set<DietPreference>(ALL_DIETS);
  for (const ing of recipe.ingredients) {
    const kind = ing.dietKind ?? "unknown";
    for (const diet of ALL_DIETS) {
      if (!isKindCompatibleWithDiet(kind, diet) && result.has(diet)) {
        result.delete(diet);
      }
    }
    if (result.size === 0) return result;
  }
  return result;
}

/** Pure diet-vs-kind compatibility check — same rules as
 *  `isCompatibleWithDiet` but operating on a pre-classified kind. Exported
 *  for tests; the public surface is `isCompatibleWithDiet` /
 *  `recipeDietCompatibility`. */
export function isKindCompatibleWithDiet(
  kind: ClassifiedKind,
  diet: DietPreference,
): boolean {
  if (kind === "unknown") return diet === "omnivore";
  switch (diet) {
    case "omnivore":
      return true;
    case "pescatarian":
      return kind !== "land-meat";
    case "vegetarian":
      return kind !== "land-meat" && kind !== "seafood";
    case "vegan":
      return kind === "plant";
    case "carnivore":
      return kind !== "plant";
  }
}

/** Human-readable label per kind — used by the My Foods view + the
 * CustomFoodForm "Kind" select. Kept here so the vocabulary lives in one
 * place. */
export const FOOD_KIND_LABEL: Record<FoodKind, string> = {
  "land-meat": "Land meat (poultry, beef, pork, lamb…)",
  seafood: "Seafood (fish, shellfish)",
  egg: "Egg",
  dairy: "Dairy (milk, cheese, yogurt, whey)",
  honey: "Honey",
  plant: "Plant (vegetables, grains, legumes, oils, nuts)",
};
