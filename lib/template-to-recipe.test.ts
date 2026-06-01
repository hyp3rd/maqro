import type { MealTemplate } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { templateToRecipeDraft } from "./template-to-recipe";

function makeTemplate(overrides: Partial<MealTemplate> = {}): MealTemplate {
  return {
    id: "tpl-1",
    name: "Greek Yogurt Bowl",
    foods: [],
    createdAt: 0,
    updatedAt: 0,
    localUpdatedAt: "2026-05-21T00:00:00Z",
    serverUpdatedAt: null,
    ...overrides,
  };
}

describe("templateToRecipeDraft", () => {
  it("carries the template name into the draft", () => {
    const draft = templateToRecipeDraft(makeTemplate());
    expect(draft.name).toBe("Greek Yogurt Bowl");
    expect(draft.ingredients).toEqual([]);
  });

  it("uses originalValues per-100g when present (no math)", () => {
    const draft = templateToRecipeDraft(
      makeTemplate({
        foods: [
          {
            id: 1,
            name: "Greek Yogurt",
            protein: 10,
            carbs: 4,
            fat: 0,
            calories: 56,
            portionSize: 100,
            originalValues: {
              proteinPer100g: 10,
              carbsPer100g: 4,
              fatPer100g: 0,
              caloriesPer100g: 56,
            },
          },
        ],
      }),
    );
    expect(draft.ingredients).toEqual([
      {
        foodName: "Greek Yogurt",
        portionGrams: 100,
        macrosPer100g: { protein: 10, carbs: 4, fat: 0, calories: 56 },
      },
    ]);
  });

  it("back-computes per-100g when originalValues is missing", () => {
    // 50 g of a food with 10 g protein → 20 g/100g protein.
    const draft = templateToRecipeDraft(
      makeTemplate({
        foods: [
          {
            id: 1,
            name: "Hand-entered chicken",
            protein: 10,
            carbs: 0,
            fat: 5,
            calories: 90,
            portionSize: 50,
          },
        ],
      }),
    );
    expect(draft.ingredients[0]?.macrosPer100g).toEqual({
      protein: 20,
      carbs: 0,
      fat: 10,
      calories: 180,
    });
    expect(draft.ingredients[0]?.portionGrams).toBe(50);
  });

  it("falls back to absolute macros when portionSize is zero", () => {
    // Divide-by-zero guard — recipe still saves; the user can fix
    // the portion in the edit form.
    const draft = templateToRecipeDraft(
      makeTemplate({
        foods: [
          {
            id: 1,
            name: "Mystery",
            protein: 3,
            carbs: 2,
            fat: 1,
            calories: 25,
            portionSize: 0,
          },
        ],
      }),
    );
    expect(draft.ingredients[0]?.macrosPer100g).toEqual({
      protein: 3,
      carbs: 2,
      fat: 1,
      calories: 25,
    });
  });

  it("preserves the order of foods", () => {
    const draft = templateToRecipeDraft(
      makeTemplate({
        foods: [
          {
            id: 1,
            name: "A",
            protein: 0,
            carbs: 0,
            fat: 0,
            calories: 0,
            portionSize: 100,
          },
          {
            id: 2,
            name: "B",
            protein: 0,
            carbs: 0,
            fat: 0,
            calories: 0,
            portionSize: 100,
          },
          {
            id: 3,
            name: "C",
            protein: 0,
            carbs: 0,
            fat: 0,
            calories: 0,
            portionSize: 100,
          },
        ],
      }),
    );
    expect(draft.ingredients.map((i) => i.foodName)).toEqual(["A", "B", "C"]);
  });
});
