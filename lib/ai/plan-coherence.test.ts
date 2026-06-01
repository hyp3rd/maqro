import type { FoodItem, Meal } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { validatePlanCoherence } from "./plan-coherence";

let nextId = 1;
function food(
  name: string,
  macros: { protein?: number; carbs?: number; fat?: number; calories?: number },
  portionSize = 100,
): FoodItem {
  const protein = macros.protein ?? 0;
  const carbs = macros.carbs ?? 0;
  const fat = macros.fat ?? 0;
  const calories =
    macros.calories ?? Math.round(protein * 4 + carbs * 4 + fat * 9);
  return { id: nextId++, name, protein, carbs, fat, calories, portionSize };
}

function meal(name: string, foods: FoodItem[]): Meal {
  return { id: nextId++, name, foods };
}

const DEFAULT_TARGETS = { protein: 150, calories: 2000 };

// Each meal in the helper plan delivers ~37g protein so the day's total
// passes the low-day-protein floor (≥60% of 150). Individual tests
// override specific meals to trigger their target rule without tripping
// the protein floor.
function baselineMeals(): Meal[] {
  return [
    meal("Breakfast", [
      food("Greek Yogurt", { protein: 18, carbs: 6, fat: 0 }, 200),
      food("Oats", { protein: 13, carbs: 67, fat: 7 }, 60),
    ]),
    meal("Lunch", [
      food("Chicken Breast", { protein: 31, carbs: 0, fat: 3.6 }, 150),
      food("Brown Rice", { protein: 2.6, carbs: 23, fat: 0.9 }, 200),
      food("Broccoli", { protein: 2.8, carbs: 7, fat: 0.4 }, 150),
    ]),
    meal("Dinner", [
      food("Salmon", { protein: 20, carbs: 0, fat: 13 }, 150),
      food("Sweet Potato", { protein: 2, carbs: 20, fat: 0.1 }, 200),
      food("Spinach", { protein: 2.9, carbs: 3.6, fat: 0.4 }, 100),
    ]),
    meal("Snack", [food("Apple", { protein: 0.3, carbs: 14, fat: 0.2 }, 150)]),
  ];
}

describe("validatePlanCoherence", () => {
  it("returns no issues for a sensible plan", () => {
    const issues = validatePlanCoherence(baselineMeals(), DEFAULT_TARGETS);
    expect(issues).toEqual([]);
  });

  it("flags a single-food meal that is overwhelmingly fat (standalone-fat)", () => {
    const meals = baselineMeals();
    meals[1] = meal("Lunch", [
      food("Olive Oil", { protein: 0, carbs: 0, fat: 65, calories: 575 }, 65),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const standalone = issues.find((i) => i.code === "standalone-fat");
    expect(standalone).toBeDefined();
    expect(standalone?.message).toMatch(/Lunch/);
    expect(standalone?.message).toMatch(/Olive Oil/);
  });

  it("does NOT flag a salad with olive oil as standalone-fat (multi-food)", () => {
    const meals = baselineMeals();
    meals[1] = meal("Lunch", [
      food("Mixed Greens", { protein: 1, carbs: 4, fat: 0.2 }, 100),
      food("Olive Oil", { protein: 0, carbs: 0, fat: 14 }, 14),
      food("Chicken Breast", { protein: 31, carbs: 0, fat: 3.6 }, 150),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    expect(issues.find((i) => i.code === "standalone-fat")).toBeUndefined();
  });

  it("flags two fish species in one meal (multi-fish)", () => {
    const meals = baselineMeals();
    meals[2] = meal("Dinner", [
      food("Salmon", { protein: 20, carbs: 0, fat: 13 }, 100),
      food("Pangasius Filets", { protein: 15, carbs: 0, fat: 3 }, 100),
      food("Broccoli", { protein: 2.8, carbs: 7, fat: 0.4 }, 100),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const multi = issues.find((i) => i.code === "multi-fish");
    expect(multi).toBeDefined();
    expect(multi?.message.toLowerCase()).toMatch(/salmon/);
    expect(multi?.message.toLowerCase()).toMatch(/pangasius/);
  });

  it("flags two meats in one meal (multi-meat)", () => {
    const meals = baselineMeals();
    meals[1] = meal("Lunch", [
      food("Chicken Breast", { protein: 31, carbs: 0, fat: 3.6 }, 100),
      food("Beef Sirloin", { protein: 26, carbs: 0, fat: 8 }, 100),
      food("Brown Rice", { protein: 2.6, carbs: 23, fat: 0.9 }, 100),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const multi = issues.find((i) => i.code === "multi-meat");
    expect(multi).toBeDefined();
    expect(multi?.message.toLowerCase()).toMatch(/chicken/);
    expect(multi?.message.toLowerCase()).toMatch(/beef/);
  });

  it("flags fish + meat in one meal (fish-and-meat)", () => {
    const meals = baselineMeals();
    meals[2] = meal("Dinner", [
      food("Salmon", { protein: 20, carbs: 0, fat: 13 }, 100),
      food("Chicken Breast", { protein: 31, carbs: 0, fat: 3.6 }, 100),
      food("Brown Rice", { protein: 2.6, carbs: 23, fat: 0.9 }, 100),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const mix = issues.find((i) => i.code === "fish-and-meat");
    expect(mix).toBeDefined();
  });

  it("flags a main meal with no protein source (naked-carb)", () => {
    // 300g rice scaled + 100g broccoli scaled - total ≈ 380 kcal,
    // protein-source detection finds neither.
    const meals = baselineMeals();
    meals[1] = meal("Lunch", [
      food("Brown Rice", { protein: 7.8, carbs: 69, fat: 2.7 }, 300),
      food("Broccoli", { protein: 2.8, carbs: 7, fat: 0.4 }, 100),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const naked = issues.find((i) => i.code === "naked-carb");
    expect(naked).toBeDefined();
    expect(naked?.message).toMatch(/Lunch/);
  });

  it("does NOT flag a snack as naked-carb (snacks are exempt)", () => {
    const meals = baselineMeals();
    meals[3] = meal("Snack", [
      food("Apple", { protein: 0.3, carbs: 14, fat: 0.2 }, 200),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    expect(issues.find((i) => i.code === "naked-carb")).toBeUndefined();
  });

  it("flags a snack with too many categories (snack-monster)", () => {
    const meals = baselineMeals();
    meals[3] = meal("Snack", [
      food("Raspberries", { protein: 1.2, carbs: 12, fat: 0.7 }, 100),
      food("Cheddar Cheese", { protein: 25, carbs: 1.3, fat: 33 }, 30),
      food("Pangasius Filets", { protein: 15, carbs: 0, fat: 3 }, 80),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const monster = issues.find((i) => i.code === "snack-monster");
    expect(monster).toBeDefined();
    expect(monster?.message).toMatch(/Snack/);
  });

  it("does NOT flag a simple two-item snack (cheese + crackers)", () => {
    const meals = baselineMeals();
    meals[3] = meal("Snack", [
      food("Cheddar Cheese", { protein: 25, carbs: 1.3, fat: 33 }, 30),
      food("Whole Grain Crackers", { protein: 8, carbs: 65, fat: 12 }, 30),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    expect(issues.find((i) => i.code === "snack-monster")).toBeUndefined();
  });

  it("flags day's protein below 60% of target (low-day-protein)", () => {
    // Day totals: 4*0.3 + 4*1 + 4*2 + 4*0.3 ≈ tiny protein
    const meals = [
      meal("Breakfast", [
        food("Apple", { protein: 0.3, carbs: 14, fat: 0.2 }, 200),
      ]),
      meal("Lunch", [
        food("Olive Oil", { protein: 0, carbs: 0, fat: 65, calories: 575 }, 65),
      ]),
      meal("Dinner", [
        food("Pasta", { protein: 13, carbs: 75, fat: 1.5 }, 100),
      ]),
      meal("Snack", [
        food("Banana", { protein: 1.1, carbs: 23, fat: 0.3 }, 120),
      ]),
    ];
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const low = issues.find((i) => i.code === "low-day-protein");
    expect(low).toBeDefined();
    expect(low?.message).toMatch(/Day's total protein/);
  });

  it("does NOT flag low-day-protein when target is 0", () => {
    const meals = baselineMeals();
    const issues = validatePlanCoherence(meals, { protein: 0, calories: 2000 });
    expect(issues.find((i) => i.code === "low-day-protein")).toBeUndefined();
  });

  it("skips empty meals entirely (no false positives)", () => {
    const meals = baselineMeals();
    meals[3] = meal("Snack", []);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    // None of the per-meal rules should fire on the empty snack.
    expect(
      issues.filter((i) =>
        ["standalone-fat", "naked-carb", "snack-monster"].includes(i.code),
      ),
    ).toEqual([]);
  });

  it("returns multiple issues across different meals", () => {
    const meals = baselineMeals();
    meals[1] = meal("Lunch", [
      food("Olive Oil", { protein: 0, carbs: 0, fat: 65, calories: 575 }, 65),
    ]);
    meals[2] = meal("Dinner", [
      food("Salmon", { protein: 20, carbs: 0, fat: 13 }, 100),
      food("Pangasius Filets", { protein: 15, carbs: 0, fat: 3 }, 100),
    ]);
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    expect(issues.some((i) => i.code === "standalone-fat")).toBe(true);
    expect(issues.some((i) => i.code === "multi-fish")).toBe(true);
  });

  it("tags per-meal issues with mealName but leaves day-level ones unscoped", () => {
    const meals = [
      meal("Breakfast", [
        food("Apple", { protein: 0.3, carbs: 14, fat: 0.2 }, 200),
      ]),
      meal("Lunch", [
        food("Olive Oil", { protein: 0, carbs: 0, fat: 65, calories: 575 }, 65),
      ]),
      meal("Dinner", [
        food("Salmon", { protein: 20, carbs: 0, fat: 13 }, 100),
        food("Pangasius Filets", { protein: 15, carbs: 0, fat: 3 }, 100),
      ]),
      meal("Snack", [
        food("Banana", { protein: 1.1, carbs: 23, fat: 0.3 }, 120),
      ]),
    ];
    const issues = validatePlanCoherence(meals, DEFAULT_TARGETS);
    const standalone = issues.find((i) => i.code === "standalone-fat");
    const multiFish = issues.find((i) => i.code === "multi-fish");
    const lowProtein = issues.find((i) => i.code === "low-day-protein");
    expect(standalone?.mealName).toBe("Lunch");
    expect(multiFish?.mealName).toBe("Dinner");
    expect(lowProtein?.mealName).toBeUndefined();
  });
});
