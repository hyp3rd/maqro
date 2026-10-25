/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meal } from "@maqro/core/types";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MealHubSheet } from "./MealHubSheet";

// The hub's data-backed children: stubs keep this test on its own actions.
vi.mock("@/hooks/use-past-meals", () => ({ usePastMealsForSlot: () => [] }));
vi.mock("./FoodSearchSheet", () => ({ FoodSearchSheet: () => null }));
vi.mock("./QuickAddFoods", () => ({ QuickAddFoods: () => null }));
vi.mock("./MealDetailSheet", () => ({ MealDetail: () => null }));

afterEach(() => cleanup());

function renderHub(meal: Meal) {
  render(
    <MealHubSheet
      meal={meal}
      customFoodsRev={0}
      onLogFood={vi.fn()}
      onQuickLog={vi.fn()}
      intent="add"
      onRemoveFood={vi.fn()}
      onCopyMeal={vi.fn()}
      onAddFromTemplate={vi.fn()}
      onApplyRecipe={vi.fn()}
      onRegenerate={vi.fn()}
      regenerating={false}
      regeneratingThisMeal={false}
      onOpenChange={vi.fn()}
    />,
  );
  return screen.getByRole("dialog");
}

describe("MealHubSheet: an empty meal's shortcuts", () => {
  it("a regular meal offers AI generate beside template and recipe", () => {
    const hub = renderHub({ id: 3, name: "Dinner", foods: [] });
    for (const name of ["Use template", "Apply recipe", "AI generate"]) {
      expect(within(hub).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("a workout meal has no AI generate yet", () => {
    const hub = renderHub({
      id: 5,
      name: "Pre-workout",
      role: "preWorkout",
      foods: [],
    });
    expect(
      within(hub).getByRole("button", { name: "Apply recipe" }),
    ).toBeTruthy();
    expect(
      within(hub).queryByRole("button", { name: "AI generate" }),
    ).toBeNull();
  });
});
