import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import {
  replaceDayIfUnchanged,
  replaceMealIfUnchanged,
  sameMeals,
} from "./daily-log-cas";

function food(id: number, name: string): FoodItem {
  return {
    id,
    name,
    protein: 10,
    carbs: 10,
    fat: 5,
    calories: 125,
    portionSize: 100,
  };
}

const EMPTY_DAY: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Snacks", foods: [] },
];

const PLAN: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(10, "Oats")] },
  { id: 2, name: "Lunch", foods: [food(11, "Rice")] },
  { id: 3, name: "Snacks", foods: [food(12, "Apple")] },
];

describe("sameMeals", () => {
  it("compares structurally, not by reference", () => {
    expect(sameMeals(EMPTY_DAY, structuredClone(EMPTY_DAY))).toBe(true);
    expect(sameMeals(EMPTY_DAY, PLAN)).toBe(false);
  });
});

describe("replaceDayIfUnchanged", () => {
  it("applies the plan when the day still matches the snapshot", () => {
    expect(
      replaceDayIfUnchanged(structuredClone(EMPTY_DAY), EMPTY_DAY, PLAN),
    ).toBe(PLAN);
  });

  it("rejects the plan when a food was logged while it was generating", () => {
    const withSnack = EMPTY_DAY.map((m) =>
      m.id === 3 ? { ...m, foods: [food(99, "Yogurt")] } : m,
    );
    expect(replaceDayIfUnchanged(withSnack, EMPTY_DAY, PLAN)).toBeNull();
  });
});

describe("replaceMealIfUnchanged", () => {
  const newLunch: Meal = { id: 2, name: "Lunch", foods: [food(20, "Pasta")] };

  it("swaps only the target slot and keeps concurrent edits to other slots", () => {
    const snapshotLunch = EMPTY_DAY[1]!;
    const latest = EMPTY_DAY.map((m) =>
      m.id === 3 ? { ...m, foods: [food(99, "Yogurt")] } : m,
    );
    const next = replaceMealIfUnchanged(latest, snapshotLunch, newLunch);
    expect(next).toEqual([
      EMPTY_DAY[0],
      newLunch,
      { id: 3, name: "Snacks", foods: [food(99, "Yogurt")] },
    ]);
  });

  it("rejects when the target slot itself changed", () => {
    const snapshotLunch = EMPTY_DAY[1]!;
    const latest = EMPTY_DAY.map((m) =>
      m.id === 2 ? { ...m, foods: [food(98, "Soup")] } : m,
    );
    expect(replaceMealIfUnchanged(latest, snapshotLunch, newLunch)).toBeNull();
  });

  it("rejects when the target slot no longer exists", () => {
    const latest = EMPTY_DAY.filter((m) => m.id !== 2);
    expect(replaceMealIfUnchanged(latest, EMPTY_DAY[1]!, newLunch)).toBeNull();
  });
});
