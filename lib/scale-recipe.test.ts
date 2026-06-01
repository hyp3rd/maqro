import type { RecipeIngredient } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  MAX_RECIPE_SCALE,
  MIN_RECIPE_SCALE,
  clampScale,
  formatScale,
  scaleRecipeIngredients,
} from "./scale-recipe";

function ing(overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    foodName: "Test",
    portionGrams: 100,
    macrosPer100g: { protein: 10, carbs: 20, fat: 5, calories: 165 },
    ...overrides,
  };
}

describe("scaleRecipeIngredients", () => {
  it("returns the input unchanged for scale = 1", () => {
    const input = [ing(), ing({ portionGrams: 50 })];
    const out = scaleRecipeIngredients(input, 1);
    expect(out).toEqual(input);
  });

  it("doubles every portionGrams at 2×", () => {
    const out = scaleRecipeIngredients(
      [ing({ portionGrams: 100 }), ing({ portionGrams: 75 })],
      2,
    );
    expect(out.map((i) => i.portionGrams)).toEqual([200, 150]);
  });

  it("halves every portionGrams at 0.5×", () => {
    const out = scaleRecipeIngredients(
      [ing({ portionGrams: 100 }), ing({ portionGrams: 75 })],
      0.5,
    );
    expect(out.map((i) => i.portionGrams)).toEqual([50, 38]);
  });

  it("rounds to integers and floors at 1g for tiny ingredients", () => {
    const out = scaleRecipeIngredients(
      [ing({ portionGrams: 3 }), ing({ portionGrams: 1 })],
      0.25,
    );
    expect(out.map((i) => i.portionGrams)).toEqual([1, 1]);
  });

  it("leaves macrosPer100g untouched (they're per-100g constants)", () => {
    const out = scaleRecipeIngredients(
      [ing({ macrosPer100g: { protein: 12, carbs: 0, fat: 0, calories: 48 } })],
      3,
    );
    expect(out[0]?.macrosPer100g).toEqual({
      protein: 12,
      carbs: 0,
      fat: 0,
      calories: 48,
    });
  });

  it("clamps an out-of-range scale to the allowed window", () => {
    const big = scaleRecipeIngredients([ing({ portionGrams: 100 })], 999);
    expect(big[0]?.portionGrams).toBe(MAX_RECIPE_SCALE * 100);
    const tiny = scaleRecipeIngredients([ing({ portionGrams: 100 })], 0);
    expect(tiny[0]?.portionGrams).toBe(MIN_RECIPE_SCALE * 100);
  });
});

describe("clampScale", () => {
  it("returns 1 for NaN / Infinity", () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(1);
  });
  it("clamps below the floor", () => {
    expect(clampScale(0.1)).toBe(MIN_RECIPE_SCALE);
  });
  it("clamps above the ceiling", () => {
    expect(clampScale(99)).toBe(MAX_RECIPE_SCALE);
  });
  it("returns valid values unchanged", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.5)).toBe(0.5);
    expect(clampScale(3)).toBe(3);
  });
});

describe("formatScale", () => {
  it("drops decimals on integers", () => {
    expect(formatScale(1)).toBe("1×");
    expect(formatScale(2)).toBe("2×");
    expect(formatScale(10)).toBe("10×");
  });
  it("keeps one decimal on halves", () => {
    expect(formatScale(0.5)).toBe("0.5×");
    expect(formatScale(1.5)).toBe("1.5×");
  });
  it("keeps two decimals on quarters", () => {
    expect(formatScale(0.25)).toBe("0.25×");
    expect(formatScale(0.75)).toBe("0.75×");
  });
});
