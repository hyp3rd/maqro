import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import {
  markEaten,
  plannedFoodIds,
  unmarkEaten,
  withPlannedTime,
} from "./meal-eaten";

const BREAKFAST_AT = new Date(2026, 9, 26, 8, 0).getTime();
const LUNCH_AT = new Date(2026, 9, 26, 12, 40).getTime();

function food(id: number, loggedAt?: number): FoodItem {
  return {
    id,
    name: `food ${id}`,
    protein: 10,
    carbs: 20,
    fat: 5,
    calories: 165,
    portionSize: 100,
    ...(loggedAt === undefined ? {} : { loggedAt }),
  };
}

const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(1, BREAKFAST_AT)] },
  // Half eaten: rice logged, the yogurt still planned.
  { id: 2, name: "Lunch", foods: [food(2, BREAKFAST_AT), food(3), food(4)] },
  { id: 3, name: "Dinner", foods: [food(5)], plannedTime: "19:00" },
];

describe("plannedFoodIds", () => {
  it("lists the foods not logged as eaten", () => {
    expect(MEALS.map(plannedFoodIds)).toEqual([[], [3, 4], [5]]);
  });
});

describe("markEaten", () => {
  it("stamps the meal's planned foods and nothing else", () => {
    const out = markEaten(MEALS, 2, [2, 3, 4], LUNCH_AT);
    expect(out[1]?.foods.map((f) => f.loggedAt)).toEqual([
      // Already eaten: keeps its own time.
      BREAKFAST_AT,
      LUNCH_AT,
      LUNCH_AT,
    ]);
    expect(out[0]).toBe(MEALS[0]);
    expect(out[2]).toBe(MEALS[2]);
  });

  it("stamps a single food", () => {
    const out = markEaten(MEALS, 2, [4], LUNCH_AT);
    expect(out[1]?.foods.map((f) => f.loggedAt)).toEqual([
      BREAKFAST_AT,
      undefined,
      LUNCH_AT,
    ]);
  });
});

describe("unmarkEaten", () => {
  it("puts the stamped foods back to planned", () => {
    const eaten = markEaten(MEALS, 2, [3, 4], LUNCH_AT);
    const undone = unmarkEaten(eaten, 2, [3, 4], LUNCH_AT);
    expect(undone[1]).toEqual(MEALS[1]);
    expect("loggedAt" in (undone[1]?.foods[1] ?? {})).toBe(false);
  });

  it("never wipes a time set since", () => {
    const later = new Date(2026, 9, 26, 13, 5).getTime();
    const eaten = markEaten(MEALS, 2, [3], later);
    expect(unmarkEaten(eaten, 2, [3], LUNCH_AT)).toEqual(eaten);
  });
});

describe("withPlannedTime", () => {
  it("plans a meal for a time, and back at its usual time", () => {
    expect(withPlannedTime(MEALS, 2, "13:15")[1]?.plannedTime).toBe("13:15");
    const usual = withPlannedTime(MEALS, 3, undefined)[2];
    expect(usual).toEqual({ id: 3, name: "Dinner", foods: [food(5)] });
    expect("plannedTime" in (usual ?? {})).toBe(false);
  });
});
