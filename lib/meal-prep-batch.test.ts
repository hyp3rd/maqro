import type { RecipeIngredient } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { recipeIngredientToFood } from "./meal-prep-batch";

describe("recipeIngredientToFood", () => {
  it("scales per-100g macros by portion and stamps originalValues", () => {
    const ing: RecipeIngredient = {
      foodName: "Oats",
      portionGrams: 50,
      macrosPer100g: { protein: 13, carbs: 67, fat: 7, calories: 380 },
    };
    expect(recipeIngredientToFood(ing, 42)).toMatchObject({
      id: 42,
      name: "Oats",
      portionSize: 50,
      protein: 6.5, // 13 × 0.5
      carbs: 33.5, // 67 × 0.5
      fat: 3.5, // 7 × 0.5
      calories: 190, // round(380 × 0.5)
      originalValues: {
        proteinPer100g: 13,
        carbsPer100g: 67,
        fatPer100g: 7,
        caloriesPer100g: 380,
      },
    });
  });
});
