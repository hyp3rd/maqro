import type { Recipe, RecipeIngredient } from "@/components/macro/types";
import type { PantryItem } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { recipeShortfalls } from "./availability";

function ing(foodName: string, portionGrams: number): RecipeIngredient {
  return {
    foodName,
    portionGrams,
    macrosPer100g: { protein: 0, carbs: 0, fat: 0, calories: 0 },
  };
}

function recipe(ingredients: RecipeIngredient[]): Recipe {
  return { id: "r", name: "Test", ingredients, createdAt: 0, updatedAt: 0 };
}

function item(name: string, quantity: number, unit: string): PantryItem {
  return { id: name, name, quantity, unit, createdAt: 0, updatedAt: 0 };
}

describe("recipeShortfalls", () => {
  it("flags an ingredient with no matching pantry item as missing", () => {
    expect(recipeShortfalls(recipe([ing("Saffron", 2)]), [])).toEqual([
      { name: "Saffron", neededGrams: 2, kind: "missing" },
    ]);
  });

  it("covers a mass item with enough on hand", () => {
    const pantry = [item("Flour", 1, "kg")]; // 1 kg covers 500 g
    expect(recipeShortfalls(recipe([ing("Flour", 500)]), pantry)).toEqual([]);
  });

  it("flags a mass item that's short as low", () => {
    const pantry = [item("Flour", 0.2, "kg")]; // 0.2 kg < 0.5 kg
    expect(recipeShortfalls(recipe([ing("Flour", 500)]), pantry)).toEqual([
      { name: "Flour", neededGrams: 500, kind: "low" },
    ]);
  });

  it("covers a count item with at least one on hand", () => {
    const pantry = [item("Eggs", 2, "eggs")];
    expect(recipeShortfalls(recipe([ing("Eggs", 100)]), pantry)).toEqual([]);
  });

  it("scales the requirement", () => {
    const r = recipe([ing("Flour", 300)]);
    const pantry = [item("Flour", 500, "g")];
    expect(recipeShortfalls(r, pantry)).toEqual([]); // 1x: 300 <= 500
    expect(recipeShortfalls(r, pantry, 2)).toEqual([
      { name: "Flour", neededGrams: 600, kind: "low" }, // 2x: 600 > 500
    ]);
  });
});
