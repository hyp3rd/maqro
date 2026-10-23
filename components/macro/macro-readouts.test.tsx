/**
 * @vitest-environment jsdom
 */
import type { CustomFood } from "@/lib/db";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FoodViewDialog } from "./FoodViewDialog";
import { MealDetail } from "./MealDetailSheet";
import { OffSavePreviewDialog } from "./OffSavePreviewDialog";
import { RecipeViewDialog } from "./RecipeViewDialog";
import type { Food, Meal, Recipe } from "./types";

/** The four macro readouts that used to be local `MacroCell` copies now
 *  render through MacroStat. These pin the data each one shows. */

vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: { status: "anon" } }),
}));

afterEach(() => cleanup());

/** "Label: value" for every term in the macro list(s) on screen. */
function readouts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dt of document.querySelectorAll("dl dt")) {
    const value = dt.parentElement?.querySelector(":scope > dd.font-mono");
    if (value) out[dt.textContent ?? ""] = value.textContent ?? "";
  }
  return out;
}

describe("FoodViewDialog macros (per 100 g)", () => {
  it("shows calories rounded and grams exactly as stored", () => {
    const food: CustomFood = {
      id: "f1",
      name: "Greek yogurt",
      calories: 97.4,
      protein: 9,
      carbs: 3.6,
      fat: 5.05,
      createdAt: 0,
    };
    render(
      <FoodViewDialog
        open
        onOpenChange={() => {}}
        food={food}
      />,
    );
    expect(readouts()).toMatchObject({
      Calories: "97 kcal",
      Protein: "9 g",
      Carbs: "3.6 g",
      Fat: "5.05 g",
    });
  });
});

describe("OffSavePreviewDialog macros (per 100 g)", () => {
  it("shows the product's macros", () => {
    // No "off:" barcode, so the dialog does not try to enrich over fetch.
    const food: Food = {
      name: "Oat drink",
      calories: 46,
      protein: 1,
      carbs: 6.6,
      fat: 1.5,
    };
    render(
      <OffSavePreviewDialog
        open
        onOpenChange={() => {}}
        food={food}
        onSave={() => {}}
      />,
    );
    expect(readouts()).toMatchObject({
      Calories: "46 kcal",
      Protein: "1 g",
      Carbs: "6.6 g",
      Fat: "1.5 g",
    });
  });
});

describe("RecipeViewDialog macros (full recipe)", () => {
  it("shows the summed totals to one decimal", () => {
    const recipe: Recipe = {
      id: "r1",
      name: "Overnight oats",
      ingredients: [
        {
          foodName: "Oats",
          macrosPer100g: { protein: 13, carbs: 60, fat: 7, calories: 380 },
          portionGrams: 50,
        },
        {
          foodName: "Milk",
          macrosPer100g: { protein: 3.4, carbs: 5, fat: 1.5, calories: 47 },
          portionGrams: 200,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    render(
      <RecipeViewDialog
        open
        onOpenChange={() => {}}
        recipe={recipe}
      />,
    );
    expect(readouts()).toMatchObject({
      Calories: "284 kcal",
      Protein: "13.3 g",
      Carbs: "40.0 g",
      Fat: "6.5 g",
    });
  });

  it("groups four-digit calorie totals", () => {
    // MacroStat's default calorie format groups thousands ("1,234 kcal"),
    // matching DailyTotals; the old local cell printed "1234 kcal".
    const recipe: Recipe = {
      id: "r2",
      name: "Granola batch",
      ingredients: [
        {
          foodName: "Granola",
          macrosPer100g: { protein: 10, carbs: 64, fat: 18, calories: 471 },
          portionGrams: 262,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    render(
      <RecipeViewDialog
        open
        onOpenChange={() => {}}
        recipe={recipe}
      />,
    );
    expect(readouts()).toMatchObject({ Calories: "1,234 kcal" });
  });
});

describe("MealDetail macro tiles", () => {
  it("shows the meal's rounded gram totals", () => {
    const meal: Meal = {
      id: 1,
      name: "Lunch",
      foods: [
        {
          id: 1,
          name: "Rice",
          protein: 4.3,
          carbs: 44.6,
          fat: 0.4,
          calories: 206,
          portionSize: 158,
        },
        {
          id: 2,
          name: "Chicken",
          protein: 31,
          carbs: 0,
          fat: 3.6,
          calories: 165,
          portionSize: 100,
        },
      ],
    };
    render(<MealDetail meal={meal} />);
    expect(readouts()).toMatchObject({
      Protein: "35 g",
      Carbs: "45 g",
      Fat: "4 g",
    });
  });
});
