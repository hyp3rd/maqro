import type { Food } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  resolveAiRecipe,
  unmatchedIngredientNames,
  type AiRecipeSubmit,
} from "./recipe";

const catalog: Food[] = [
  {
    name: "Chicken Breast",
    protein: 31,
    carbs: 0,
    fat: 3.6,
    calories: 165,
    subCategory: "poultry",
  },
  {
    name: "Oats",
    protein: 13,
    carbs: 67,
    fat: 7,
    calories: 389,
    category: "grain",
  },
  {
    name: "Olive Oil",
    protein: 0,
    carbs: 0,
    fat: 100,
    calories: 884,
    category: "oil",
  },
];

describe("resolveAiRecipe", () => {
  it("resolves ingredient names, snapshots per-100g macros, clamps portions", () => {
    const submit: AiRecipeSubmit = {
      name: "Chicken & oats bowl",
      ingredients: [
        { name: "Chicken Breast", portionGrams: 200 },
        { name: "Oats", portionGrams: 80 },
        { name: "Olive Oil", portionGrams: 7 }, // snaps to 5
      ],
      cuisine: "American",
      notes: "Bake the chicken.",
    };
    const r = resolveAiRecipe(submit, catalog);
    expect(r.name).toBe("Chicken & oats bowl");
    expect(r.cuisine).toBe("American");
    expect(r.notes).toBe("Bake the chicken.");
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[0]).toEqual({
      foodName: "Chicken Breast",
      macrosPer100g: { protein: 31, carbs: 0, fat: 3.6, calories: 165 },
      portionGrams: 200,
      dietKind: "land-meat",
    });
    expect(r.ingredients[2].portionGrams).toBe(5); // 7 → snap to nearest 5
  });

  it("drops ingredients that don't resolve (no invented macros)", () => {
    const submit: AiRecipeSubmit = {
      name: "Mystery",
      ingredients: [
        { name: "Oats", portionGrams: 50 },
        { name: "Unicorn Bacon", portionGrams: 100 }, // not in catalog
      ],
    };
    const r = resolveAiRecipe(submit, catalog);
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0].foodName).toBe("Oats");
  });

  it("trims and truncates name to 80 chars; falls back when empty", () => {
    const r = resolveAiRecipe(
      { name: "  ", ingredients: [] },
      catalog,
      "Default name",
    );
    expect(r.name).toBe("Default name");

    const long = "x".repeat(200);
    const r2 = resolveAiRecipe({ name: long, ingredients: [] }, catalog);
    expect(r2.name.length).toBe(80);
  });

  it("trims and truncates notes to 500 chars; treats empty as undefined", () => {
    const r = resolveAiRecipe(
      { name: "X", ingredients: [], notes: "   " },
      catalog,
    );
    expect(r.notes).toBeUndefined();

    const long = "y".repeat(800);
    const r2 = resolveAiRecipe(
      { name: "X", ingredients: [], notes: long },
      catalog,
    );
    expect(r2.notes?.length).toBe(500);
  });

  it("treats empty cuisine string as undefined", () => {
    const r = resolveAiRecipe(
      { name: "X", ingredients: [], cuisine: "" },
      catalog,
    );
    expect(r.cuisine).toBeUndefined();
  });

  it("tolerates a missing ingredients array (returns empty list)", () => {
    const r = resolveAiRecipe(
      { name: "Empty" } as unknown as AiRecipeSubmit,
      catalog,
    );
    expect(r.ingredients).toEqual([]);
  });

  it("tolerates picks with non-string name (silently dropped)", () => {
    const submit = {
      name: "X",
      ingredients: [
        {
          name: 42,
          portionGrams: 50,
        } as unknown as AiRecipeSubmit["ingredients"][0],
        { name: "Oats", portionGrams: 50 },
      ],
    };
    const r = resolveAiRecipe(submit, catalog);
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0].foodName).toBe("Oats");
  });

  it("tolerates non-numeric portionGrams (defaults to 100 then clamps)", () => {
    const submit = {
      name: "X",
      ingredients: [
        {
          name: "Oats",
          portionGrams: "a lot" as unknown as number,
        } as AiRecipeSubmit["ingredients"][0],
      ],
    };
    const r = resolveAiRecipe(submit, catalog);
    expect(r.ingredients[0].portionGrams).toBe(100);
  });

  it("derives dietKind from category when explicit dietKind is missing", () => {
    // 'Oats' (catalog has category 'grain') should classify as 'plant'.
    const r = resolveAiRecipe(
      { name: "X", ingredients: [{ name: "Oats", portionGrams: 50 }] },
      catalog,
    );
    expect(r.ingredients[0].dietKind).toBe("plant");
  });

  it("loose name match: pick 'oats' inside a verbose catalog entry resolves", () => {
    const verboseCatalog: Food[] = [
      {
        name: "Rolled oats, organic — Brand X",
        protein: 13,
        carbs: 67,
        fat: 7,
        calories: 389,
        category: "grain",
      },
    ];
    const r = resolveAiRecipe(
      { name: "X", ingredients: [{ name: "Oats", portionGrams: 80 }] },
      verboseCatalog,
    );
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0].foodName).toBe("Rolled oats, organic — Brand X");
  });
});

describe("unmatchedIngredientNames", () => {
  it("returns names that don't resolve in submission order", () => {
    const submit: AiRecipeSubmit = {
      name: "Mystery",
      ingredients: [
        { name: "Oats", portionGrams: 50 }, // resolves
        { name: "Unicorn Bacon", portionGrams: 100 }, // doesn't
        { name: "Phoenix Egg", portionGrams: 60 }, // doesn't
      ],
    };
    expect(unmatchedIngredientNames(submit, catalog)).toEqual([
      "Unicorn Bacon",
      "Phoenix Egg",
    ]);
  });

  it("returns an empty array for a malformed submit", () => {
    expect(
      unmatchedIngredientNames({} as unknown as AiRecipeSubmit, catalog),
    ).toEqual([]);
  });
});
