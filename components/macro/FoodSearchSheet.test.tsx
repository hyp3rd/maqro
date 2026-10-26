/**
 * @vitest-environment jsdom
 */
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Food } from "@maqro/core/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LaterChoice } from "./EatenNowToggle";
import { FoodSearchSheet } from "./FoodSearchSheet";

const OATS: Food = {
  id: "oats",
  name: "Oats",
  protein: 13,
  carbs: 60,
  fat: 7,
  calories: 380,
};

// The search and the recents read the network and IndexedDB; one result
// is all these tests need.
vi.mock("@/hooks/use-food-search", () => ({
  useFoodSearch: () => ({ results: [OATS], isSearchingRemote: false }),
}));
vi.mock("./QuickAddFoods", () => ({ QuickAddFoods: () => null }));
vi.mock("./MarketSwitcher", () => ({ MarketSwitcher: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
});

function renderSearch(laterChoice?: LaterChoice) {
  const onLogFood = vi.fn();
  render(
    <FoodSearchSheet
      open
      onOpenChange={() => {}}
      mealId={2}
      mealName="Lunch"
      customFoodsRev={0}
      onLogFood={onLogFood}
      onBack={() => {}}
      onDone={() => {}}
      laterChoice={laterChoice}
    />,
  );
  return { onLogFood };
}

describe("FoodSearchSheet: eaten now or later", () => {
  it("adds for later with a 'Planned' toast", () => {
    const onLaterChange = vi.fn();
    const { onLogFood } = renderSearch({ later: true, onLaterChange });
    expect(
      screen.getByRole("radio", { name: "Later" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add 100 g of Oats" }));
    expect(onLogFood).toHaveBeenCalledWith(OATS, 2, 100);
    expect(toast.success).toHaveBeenCalledWith(
      "Planned Oats (100 g, 380 kcal) for Lunch",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Eaten now" }));
    expect(onLaterChange).toHaveBeenCalledWith(false);
  });

  it("adds as eaten, with no choice on another day", () => {
    renderSearch();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add 100 g of Oats" }));
    expect(toast.success).toHaveBeenCalledWith(
      "Added Oats (100 g, 380 kcal) to Lunch",
    );
  });
});
