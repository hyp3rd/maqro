/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meal } from "@maqro/core/types";
import type { WorkoutMealsPlan } from "@maqro/core/workout-meals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MealHubSheet } from "./MealHubSheet";

// The hub's data-backed children: stubs keep this test on its own actions.
vi.mock("@/hooks/use-past-meals", () => ({ usePastMealsForSlot: () => [] }));
const search = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("./FoodSearchSheet", () => ({
  FoodSearchSheet: (p: Record<string, unknown>) => {
    search.props = p;
    return null;
  },
}));
vi.mock("./QuickAddFoods", () => ({ QuickAddFoods: () => null }));
vi.mock("./MealDetailSheet", () => ({ MealDetail: () => null }));

afterEach(() => cleanup());

const PRE: Meal = { id: 5, name: "Pre-workout", role: "preWorkout", foods: [] };
const AIMS = { protein: 30, carbs: 40, fat: 10, calories: 370 };
const PLAN: WorkoutMealsPlan = {
  session: { type: "upper", time: "18:00", durationMin: 60 },
  heavyOrLong: false,
  fasted: false,
  earlySession: false,
  pre: {
    role: "preWorkout",
    id: 5,
    name: "Pre-workout",
    aims: AIMS,
    window: { start: 15 * 60, end: 17 * 60 },
    aimMinute: 16 * 60 + 30,
  },
  post: null,
};

function renderHub(meal: Meal, workoutMeals: WorkoutMealsPlan | null = null) {
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
      workoutMeals={workoutMeals}
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

  it("a workout meal the day plans offers AI generate", () => {
    const hub = renderHub(PRE, PLAN);
    expect(
      within(hub).getByRole("button", { name: "AI generate" }),
    ).toBeTruthy();
  });

  it("a workout meal the day doesn't plan has no AI generate", () => {
    const hub = renderHub(PRE, null);
    expect(
      within(hub).getByRole("button", { name: "Apply recipe" }),
    ).toBeTruthy();
    expect(
      within(hub).queryByRole("button", { name: "AI generate" }),
    ).toBeNull();
  });
});

describe("MealHubSheet: eaten now or later", () => {
  it("on today, offers the choice above the recents and hands it to its search", () => {
    const onLaterChange = vi.fn();
    const laterChoice = { later: true, onLaterChange };
    render(
      <MealHubSheet
        meal={{ id: 3, name: "Dinner", foods: [] }}
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
        laterChoice={laterChoice}
      />,
    );
    const hub = screen.getByRole("dialog");
    expect(
      within(hub)
        .getByRole("radio", { name: "Later" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(hub).getByRole("radio", { name: "Eaten now" }));
    expect(onLaterChange).toHaveBeenCalledWith(false);
    expect(search.props?.laterChoice).toBe(laterChoice);
  });

  it("has no choice on another day", () => {
    const hub = renderHub({ id: 3, name: "Dinner", foods: [] });
    expect(within(hub).queryByRole("radiogroup")).toBeNull();
  });
});
