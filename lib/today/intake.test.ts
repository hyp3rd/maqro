import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import { dayIntake } from "./intake";

function food(calories: number, loggedAt?: number): FoodItem {
  return {
    id: calories,
    name: "food",
    protein: calories / 20,
    carbs: calories / 10,
    fat: calories / 45,
    calories,
    portionSize: 100,
    ...(loggedAt === undefined ? {} : { loggedAt }),
  };
}

const NOW = new Date(2026, 9, 26, 12, 0).getTime();

const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(420, NOW - 4 * 3600_000)] },
  // Lunch half eaten: one food logged, one planned.
  { id: 2, name: "Lunch", foods: [food(300, NOW), food(250)] },
  { id: 3, name: "Dinner", foods: [food(650)] },
  { id: 4, name: "Snacks", foods: [] },
];

describe("dayIntake", () => {
  it("today: logged food is eaten, the rest is planned", () => {
    const { eaten, planned } = dayIntake(MEALS, "today");
    expect(eaten).toEqual({ calories: 720, protein: 36, carbs: 72, fat: 16 });
    expect(planned).toEqual({ calories: 900, protein: 45, carbs: 90, fat: 20 });
  });

  it("another day keeps its single total; nothing is planned", () => {
    for (const when of ["past", "future"] as const) {
      const { eaten, planned } = dayIntake(MEALS, when);
      expect(eaten.calories).toBe(1620);
      expect(planned).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    }
  });

  it("an empty day is zeros", () => {
    expect(dayIntake([], "today")).toEqual({
      eaten: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      planned: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });
});
