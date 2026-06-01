import type { Recipe, RecipeIngredient } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  computeSlotBudget,
  rankRecipesByFit,
  recipePerServingMacros,
} from "./recipe-ranking";

function ingredient(
  foodName: string,
  protein: number,
  carbs: number,
  fat: number,
  portionGrams: number,
  calories?: number,
): RecipeIngredient {
  return {
    foodName,
    portionGrams,
    macrosPer100g: {
      protein,
      carbs,
      fat,
      calories: calories ?? protein * 4 + carbs * 4 + fat * 9,
    },
  };
}

function recipe(
  id: string,
  name: string,
  ingredients: RecipeIngredient[],
  servings?: number,
): Recipe {
  return { id, name, ingredients, servings, createdAt: 0, updatedAt: 0 };
}

describe("recipePerServingMacros", () => {
  it("sums per-100g × portion and divides by servings", () => {
    const r = recipe(
      "r1",
      "Test",
      [
        ingredient("Chicken Breast", 31, 0, 3.6, 200), // 62 P, 0 C, 7.2 F
        ingredient("Rice", 2.7, 28, 0.3, 150), // 4.05 P, 42 C, 0.45 F
      ],
      2,
    );
    const per = recipePerServingMacros(r);
    expect(per.protein).toBeCloseTo((62 + 4.05) / 2, 3);
    expect(per.carbs).toBeCloseTo(42 / 2, 3);
    expect(per.fat).toBeCloseTo((7.2 + 0.45) / 2, 3);
  });

  it("treats missing or zero servings as 1", () => {
    const r = recipe("r1", "Test", [ingredient("Egg", 13, 1, 11, 100)]);
    const per = recipePerServingMacros(r);
    expect(per.protein).toBeCloseTo(13, 3);

    const r0 = recipe(
      "r2",
      "Zero-servings",
      [ingredient("Egg", 13, 1, 11, 100)],
      0,
    );
    expect(recipePerServingMacros(r0).protein).toBeCloseTo(13, 3);
  });
});

describe("computeSlotBudget", () => {
  it("divides the day evenly across slots", () => {
    const budget = computeSlotBudget({ protein: 160, carbs: 200, fat: 80 }, 4);
    expect(budget.protein).toBe(40);
    expect(budget.carbs).toBe(50);
    expect(budget.fat).toBe(20);
  });

  it("returns zeros when slots is 0 or negative", () => {
    expect(computeSlotBudget({ protein: 160, carbs: 200, fat: 80 }, 0)).toEqual(
      { protein: 0, carbs: 0, fat: 0 },
    );
    expect(
      computeSlotBudget({ protein: 160, carbs: 200, fat: 80 }, -1),
    ).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
});

describe("rankRecipesByFit", () => {
  // Perfect fit per serving: 40P / 50C / 20F
  const perfect = recipe("perfect", "Perfect Fit", [
    ingredient("Chicken", 40, 0, 0, 100), // 40P, 0C, 0F per recipe
    ingredient("Rice", 0, 50, 0, 100), // 0P, 50C, 0F per recipe
    ingredient("Oil", 0, 0, 20, 100), // 0P, 0C, 20F per recipe
  ]);
  // Double everything
  const tooBig = recipe("big", "Too Big", [
    ingredient("Chicken", 80, 0, 0, 100),
    ingredient("Rice", 0, 100, 0, 100),
    ingredient("Oil", 0, 0, 40, 100),
  ]);
  // Half everything
  const tooSmall = recipe("small", "Too Small", [
    ingredient("Chicken", 20, 0, 0, 100),
    ingredient("Rice", 0, 25, 0, 100),
    ingredient("Oil", 0, 0, 10, 100),
  ]);

  it("orders best-fit first when a usable budget is supplied", () => {
    const ranked = rankRecipesByFit([tooBig, tooSmall, perfect], {
      protein: 40,
      carbs: 50,
      fat: 20,
    });
    expect(ranked[0].recipe.id).toBe("perfect");
    expect(ranked[0].fitScore).toBeCloseTo(0, 3);
    expect(ranked[1].recipe.id).toBe("small");
    expect(ranked[2].recipe.id).toBe("big");
  });

  it("returns original order with undefined scores when no budget", () => {
    const ranked = rankRecipesByFit([tooBig, perfect, tooSmall], undefined);
    expect(ranked.map((r) => r.recipe.id)).toEqual(["big", "perfect", "small"]);
    for (const r of ranked) expect(r.fitScore).toBeUndefined();
  });

  it("treats an all-zero budget as no budget", () => {
    const ranked = rankRecipesByFit([tooBig, perfect], {
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(ranked.map((r) => r.recipe.id)).toEqual(["big", "perfect"]);
    for (const r of ranked) expect(r.fitScore).toBeUndefined();
  });

  it("skips zero-budget macros instead of dividing by zero", () => {
    // Budget says fat doesn't matter at all (0); protein + carbs do.
    const ranked = rankRecipesByFit([tooBig, perfect], {
      protein: 40,
      carbs: 50,
      fat: 0,
    });
    expect(ranked[0].recipe.id).toBe("perfect");
    expect(ranked[0].fitScore).toBeCloseTo(0, 3);
  });

  it("caps each macro component so one wild miss can't swamp the score", () => {
    // Recipe with 10x protein, perfect on the other two. Without
    // capping, the protein component alone would be 9; capped at 2.0.
    const skewed = recipe("skew", "Skewed", [
      ingredient("Whey", 400, 0, 0, 100), // 400P per recipe
      ingredient("Rice", 0, 50, 0, 100),
      ingredient("Oil", 0, 0, 20, 100),
    ]);
    const ranked = rankRecipesByFit([skewed], {
      protein: 40,
      carbs: 50,
      fat: 20,
    });
    expect(ranked[0].fitScore).toBeCloseTo(2.0, 3);
  });
});
