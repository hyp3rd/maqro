/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import PublicRecipePage from "./page";

/** The shared-recipe page's macro list renders through MacroStat. The
 *  Supabase read and the auth lookup are the page's I/O seams. */

const recipeRow = {
  name: "Lentil soup",
  cuisine: null,
  notes: null,
  ingredients: [
    {
      foodName: "Lentils",
      macrosPer100g: { protein: 9, carbs: 20, fat: 0.4, calories: 116 },
      portionGrams: 300,
    },
    {
      foodName: "Olive oil",
      macrosPer100g: { protein: 0, carbs: 0, fat: 100, calories: 884 },
      portionGrams: 10,
    },
  ],
};

let currentRow: typeof recipeRow = recipeRow;

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: currentRow, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/effective-user", () => ({
  getEffectiveUser: async () => ({ user: null }),
}));
vi.mock("./RecipePageActions", () => ({ RecipePageActions: () => null }));

afterEach(() => {
  cleanup();
  currentRow = recipeRow;
});

describe("/r/[slug] macros", () => {
  it("lists the full-recipe totals as label/value pairs", async () => {
    render(
      await PublicRecipePage({
        params: Promise.resolve({ slug: "abcdefghij" }),
      }),
    );
    const section = screen
      .getByRole("heading", { name: "Macros (full recipe)" })
      .closest("section");
    if (!section) throw new Error("macros section missing");
    const values = Object.fromEntries(
      Array.from(section.querySelectorAll("dt")).map((dt) => [
        dt.textContent,
        dt.parentElement?.querySelector(":scope > dd.font-mono")?.textContent,
      ]),
    );
    expect(values).toEqual({
      Calories: "436 kcal",
      Protein: "27.0 g",
      Carbs: "60.0 g",
      Fat: "11.2 g",
    });
    expect(within(section).queryByRole("meter")).toBeNull();
  });

  it("groups four-digit calorie totals", async () => {
    currentRow = {
      ...recipeRow,
      ingredients: [
        {
          foodName: "Granola",
          macrosPer100g: { protein: 10, carbs: 64, fat: 18, calories: 471 },
          portionGrams: 262,
        },
      ],
    };
    render(
      await PublicRecipePage({
        params: Promise.resolve({ slug: "abcdefghij" }),
      }),
    );
    const section = screen
      .getByRole("heading", { name: "Macros (full recipe)" })
      .closest("section");
    if (!section) throw new Error("macros section missing");
    const calories = within(section).getByText("Calories").closest("dt");
    expect(
      calories?.parentElement?.querySelector(":scope > dd.font-mono")
        ?.textContent,
    ).toBe("1,234 kcal");
  });
});
