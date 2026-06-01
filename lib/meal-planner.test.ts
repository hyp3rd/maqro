import type { Food, Meal } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  det3,
  planDay,
  planMeal,
  solve3x3,
  summarisePlan,
} from "./meal-planner";

const food = (
  name: string,
  protein: number,
  carbs: number,
  fat: number,
  category?: string,
  mealTypes: string[] = ["breakfast", "lunch", "dinner", "snack"],
): Food => ({
  name,
  protein,
  carbs,
  fat,
  // 4/4/9 for self-consistency.
  calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
  category,
  mealTypes,
});

describe("det3 / solve3x3", () => {
  it("computes determinant correctly", () => {
    // Identity → 1
    expect(
      det3([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toBe(1);
    // Diagonal 2,3,4 → 24
    expect(
      det3([
        [2, 0, 0],
        [0, 3, 0],
        [0, 0, 4],
      ]),
    ).toBe(24);
  });

  it("solves a non-singular system", () => {
    // Eqs: x = 1, y = 2, z = 3 → identity matrix
    const x = solve3x3(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [1, 2, 3],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(1);
    expect(x![1]).toBeCloseTo(2);
    expect(x![2]).toBeCloseTo(3);
  });

  it("returns null for a singular matrix", () => {
    // Two identical rows → singular
    expect(
      solve3x3(
        [
          [1, 2, 3],
          [1, 2, 3],
          [4, 5, 6],
        ],
        [0, 0, 0],
      ),
    ).toBeNull();
  });

  it("rejects near-singular matrices (poor conditioning)", () => {
    // Three foods with very similar macro profiles → tiny det relative
    // to the matrix scale. The solver should refuse rather than emit
    // wildly sensitive portions.
    const result = solve3x3(
      [
        [20, 21, 19], // proteins all close to 20
        [10, 10, 11], // carbs all close to 10
        [5, 5, 5], // fats identical
      ],
      [40, 22, 11],
    );
    expect(result).toBeNull();
  });

  it("round-trips a realistic macro system", () => {
    // 3 foods: protein-pure, carb-pure, fat-pure (per 100g).
    // M = [[P_p, P_c, P_f], [C_p, C_c, C_f], [F_p, F_c, F_f]]
    const M = [
      [30, 5, 0],
      [0, 70, 0],
      [1, 1, 100],
    ];
    // Target: 50g P, 70g C, 20g F.
    const x = solve3x3(M, [50, 70, 20]);
    expect(x).not.toBeNull();
    // Verify M·x === target.
    const got = [0, 1, 2].map(
      (i) => M[i][0] * x![0] + M[i][1] * x![1] + M[i][2] * x![2],
    );
    expect(got[0]).toBeCloseTo(50);
    expect(got[1]).toBeCloseTo(70);
    expect(got[2]).toBeCloseTo(20);
  });
});

describe("planMeal", () => {
  // A minimal but viable food database with one food in each macro bucket.
  const synthetic = [
    food("Chicken", 30, 0, 3),
    food("Rice", 5, 70, 1),
    food("Olive Oil", 0, 0, 100),
    food("Spinach", 3, 4, 0, "vegetable"),
  ];

  it("solves portions that hit targets within ±10% (post-snap)", () => {
    const targets = { protein: 50, carbs: 70, fat: 20, calories: 660 };
    const result = planMeal(synthetic, targets, 1);
    expect(result.length).toBeGreaterThanOrEqual(3);

    const sum = result.reduce(
      (a, f) => ({
        protein: a.protein + f.protein,
        carbs: a.carbs + f.carbs,
        fat: a.fat + f.fat,
      }),
      { protein: 0, carbs: 0, fat: 0 },
    );
    expect(sum.protein).toBeGreaterThan(targets.protein * 0.9);
    expect(sum.protein).toBeLessThan(targets.protein * 1.1);
    expect(sum.carbs).toBeGreaterThan(targets.carbs * 0.9);
    expect(sum.carbs).toBeLessThan(targets.carbs * 1.1);
    expect(sum.fat).toBeGreaterThan(targets.fat * 0.9);
    expect(sum.fat).toBeLessThan(targets.fat * 1.1);
  });

  it("returns FoodItems with positive snapped portions", () => {
    const targets = { protein: 50, carbs: 70, fat: 20, calories: 660 };
    const result = planMeal(synthetic, targets, 100);
    for (const f of result) {
      expect(f.portionSize).toBeGreaterThan(0);
      expect(f.portionSize % 5).toBe(0);
      expect(f.originalValues).toBeDefined();
    }
  });

  it("can include a vegetable when requested", () => {
    const targets = { protein: 50, carbs: 70, fat: 20, calories: 660 };
    const result = planMeal(synthetic, targets, 1, { withVegetable: true });
    const veggie = result.find((f) => f.name === "Spinach");
    expect(veggie).toBeDefined();
    expect(veggie!.portionSize).toBe(100);
  });

  it("falls back gracefully when no triplet fits", () => {
    // Only one food available — no triplet possible.
    const result = planMeal(
      [food("Chicken", 30, 0, 3)],
      { protein: 50, carbs: 70, fat: 20, calories: 660 },
      1,
    );
    expect(result.length).toBe(1);
    expect(result[0].portionSize).toBeGreaterThan(0);
  });

  it("returns empty when no foods at all", () => {
    const result = planMeal(
      [],
      { protein: 50, carbs: 70, fat: 20, calories: 660 },
      1,
    );
    expect(result).toEqual([]);
  });

  it("never picks land-meat foods for a vegan diet preference", () => {
    const tagged = (
      base: Food,
      category: string,
      subCategory: string,
    ): Food => ({ ...base, category, subCategory });
    const chicken = tagged(
      food("Chicken", 31, 0, 4),
      "lean protein",
      "poultry",
    );
    const tofu = tagged(food("Tofu", 14, 3, 8), "plant protein", "soy");
    const rice = tagged(food("Rice", 7, 80, 1), "grain", "rice");
    const olive = tagged(food("Olive Oil", 0, 0, 100), "oil", "olive oil");

    const plan = planMeal(
      [chicken, tofu, rice, olive],
      { protein: 30, carbs: 80, fat: 25, calories: 666 },
      1,
      { dietPreference: "vegan" },
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some((f) => f.name === "Chicken")).toBe(false);
  });
});

describe("planDay", () => {
  const synthetic = [
    // Egg whites are clearly protein-dominant by calorie share.
    food("Egg whites", 11, 1, 0, "protein", ["breakfast"]),
    food("Oats", 13, 67, 7, "grain", ["breakfast"]),
    food("Butter", 1, 0, 81, "oil", ["breakfast"]),
    food("Chicken", 30, 0, 3, "lean protein", ["lunch", "dinner"]),
    food("Rice", 5, 70, 1, "grain", ["lunch", "dinner"]),
    food("Olive Oil", 0, 0, 100, "oil", ["lunch", "dinner"]),
    food("Spinach", 3, 4, 0, "vegetable", ["lunch", "dinner"]),
    food("Almonds", 21, 22, 50, "nuts", ["snack"]),
    food("Apple", 0, 14, 0, "fruit", ["snack"]),
    food("Peanut Butter", 25, 20, 50, "nut butter", ["snack"]),
  ];

  const meals: Meal[] = [
    { id: 1, name: "Breakfast", foods: [] },
    { id: 2, name: "Lunch", foods: [] },
    { id: 3, name: "Dinner", foods: [] },
    { id: 4, name: "Snacks", foods: [] },
  ];

  const daily = { protein: 150, carbs: 200, fat: 70, calories: 2000 };

  it("returns four meals with foods", () => {
    const planned = planDay(meals, synthetic, daily);
    expect(planned.length).toBe(4);
    for (const m of planned) {
      expect(m.foods.length).toBeGreaterThan(0);
    }
  });

  it("hits daily macros within ±20% (full-day tolerance)", () => {
    const planned = planDay(meals, synthetic, daily);
    const s = summarisePlan(planned, daily);
    expect(s.percent.protein).toBeGreaterThan(80);
    expect(s.percent.protein).toBeLessThan(120);
    expect(s.percent.carbs).toBeGreaterThan(80);
    expect(s.percent.carbs).toBeLessThan(120);
    expect(s.percent.fat).toBeGreaterThan(80);
    expect(s.percent.fat).toBeLessThan(120);
  });

  it("draws from custom foods (no mealTypes tag) on every meal", () => {
    // A breakfast-only builtin set that's missing a carb source —
    // a custom rice food should fill the gap for breakfast.
    const sparseBuiltin = [
      food("Egg whites", 11, 1, 0, "protein", ["breakfast"]),
      food("Butter", 1, 0, 81, "oil", ["breakfast"]),
    ];
    const customRice = food("Custom Rice", 5, 70, 1); // no mealTypes
    const breakfastOnly: Meal[] = [{ id: 1, name: "Breakfast", foods: [] }];
    // Use a single-meal distribution so all daily macros land on this meal.
    const planned = planDay(
      breakfastOnly,
      sparseBuiltin,
      { protein: 30, carbs: 40, fat: 15, calories: 415 },
      { customFoods: [customRice], distribution: { 1: 1.0 } },
    );
    // Without the custom rice, no carb-dominant food would be available
    // for breakfast and planMeal would fall back to a single food.
    const names = planned[0].foods.map((f) => f.name);
    expect(names).toContain("Custom Rice");
  });
});

describe("summarisePlan", () => {
  it("computes totals and percentages", () => {
    const meals: Meal[] = [
      {
        id: 1,
        name: "Breakfast",
        foods: [
          {
            id: 1,
            name: "Eggs",
            protein: 20,
            carbs: 2,
            fat: 14,
            calories: 220,
            portionSize: 150,
          },
        ],
      },
    ];
    const s = summarisePlan(meals, {
      protein: 40,
      carbs: 4,
      fat: 28,
      calories: 440,
    });
    expect(s.totals.protein).toBe(20);
    expect(s.percent.protein).toBe(50);
    expect(s.withinTolerance).toBe(false);
  });
});
