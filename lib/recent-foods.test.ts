import type { FoodItem } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { pastMealsForSlot, recentLoggedFoods } from "./recent-foods";

function fi(name: string, overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 1,
    name,
    protein: 10,
    carbs: 20,
    fat: 5,
    calories: 165,
    portionSize: 100,
    ...overrides,
  };
}

function log(date: string, ...foods: FoodItem[]): DailyLog {
  return { date, meals: [{ id: 1, name: "Meal", foods }], updatedAt: 0 };
}

describe("recentLoggedFoods", () => {
  const today = "2026-06-02";

  it("returns nothing for empty logs", () => {
    expect(recentLoggedFoods([], { todayKey: today })).toEqual([]);
  });

  it("dedupes by name (case-insensitive), counts, and ranks by recency", () => {
    const r = recentLoggedFoods(
      [
        log("2026-05-20", fi("Eggs"), fi("Toast")),
        log("2026-06-01", fi("eggs")), // same food, more recent
      ],
      { todayKey: today },
    );
    expect(r.map((x) => x.name)).toEqual(["eggs", "Toast"]); // Eggs newest
    const eggs = r[0];
    expect(eggs.count).toBe(2);
    expect(eggs.lastDate).toBe("2026-06-01");
  });

  it("uses the most recent occurrence's portion", () => {
    const r = recentLoggedFoods(
      [
        log("2026-05-25", fi("Oats", { portionSize: 40 })),
        log("2026-06-01", fi("Oats", { portionSize: 80 })),
      ],
      { todayKey: today },
    );
    expect(r[0].lastPortion).toBe(80);
  });

  it("reconstructs per-100g macros from the originalValues snapshot", () => {
    const r = recentLoggedFoods(
      [
        log(
          "2026-06-01",
          fi("Chicken", {
            portionSize: 200,
            protein: 60,
            carbs: 0,
            fat: 10,
            calories: 300, // scaled to 200 g
            originalValues: {
              proteinPer100g: 30,
              carbsPer100g: 0,
              fatPer100g: 5,
              caloriesPer100g: 150,
              fiber: 2,
            },
          }),
        ),
      ],
      { todayKey: today },
    );
    expect(r[0].food.calories).toBe(150);
    expect(r[0].food.protein).toBe(30);
    expect(r[0].food.fiber).toBe(2);
    expect(r[0].lastPortion).toBe(200);
  });

  it("backs per-100g out of scaled values when no snapshot exists", () => {
    const r = recentLoggedFoods(
      [
        log(
          "2026-06-01",
          fi("Rice", {
            portionSize: 200,
            protein: 8,
            carbs: 60,
            fat: 1,
            calories: 280, // scaled to 200 g
          }),
        ),
      ],
      { todayKey: today },
    );
    expect(r[0].food.calories).toBe(140);
    expect(r[0].food.carbs).toBe(30);
    expect(r[0].food.protein).toBe(4);
  });

  it("excludes foods outside the window (too old or future-dated)", () => {
    const r = recentLoggedFoods(
      [
        log("2026-04-01", fi("Old")), // > 30 days before today
        log("2026-06-10", fi("Future")), // after today
        log("2026-06-01", fi("Fresh")),
      ],
      { todayKey: today },
    );
    expect(r.map((x) => x.name)).toEqual(["Fresh"]);
  });

  it("skips blank-name and zero-calorie entries", () => {
    const r = recentLoggedFoods(
      [
        log(
          "2026-06-01",
          fi("Water", { calories: 0 }),
          fi("   ", { calories: 100 }),
          fi("Apple", { calories: 95 }),
        ),
      ],
      { todayKey: today },
    );
    expect(r.map((x) => x.name)).toEqual(["Apple"]);
  });

  it("caps the list at the limit", () => {
    const foods = Array.from({ length: 20 }, (_, i) =>
      fi(`Food${i}`, { calories: 100 }),
    );
    const r = recentLoggedFoods([log("2026-06-01", ...foods)], {
      todayKey: today,
      limit: 5,
    });
    expect(r).toHaveLength(5);
  });

  it("ranks by frequency when sort is 'frequent'", () => {
    const logs = [
      log("2026-05-20", fi("Eggs"), fi("Eggs"), fi("Eggs")), // count 3, older
      log("2026-06-01", fi("Toast")), // count 1, newer
    ];
    // Recent (default): newest first.
    expect(recentLoggedFoods(logs, { todayKey: today })[0].name).toBe("Toast");
    // Frequent: the staple leads despite being older.
    const freq = recentLoggedFoods(logs, { todayKey: today, sort: "frequent" });
    expect(freq[0].name).toBe("Eggs");
    expect(freq[0].count).toBe(3);
  });

  it("tolerates malformed rows without throwing", () => {
    const bad = [
      null,
      { date: 123 },
      { date: "2026-06-01" }, // no meals
      { date: "2026-06-01", meals: [{ id: 1, name: "M" }] }, // no foods
      log("2026-06-01", fi("Banana", { calories: 89 })),
    ] as unknown as DailyLog[];
    const r = recentLoggedFoods(bad, { todayKey: today });
    expect(r.map((x) => x.name)).toEqual(["Banana"]);
  });
});

function mealLog(
  date: string,
  meals: { name: string; foods: FoodItem[] }[],
): DailyLog {
  return {
    date,
    updatedAt: 0,
    meals: meals.map((m, i) => ({ id: i + 1, name: m.name, foods: m.foods })),
  };
}

describe("pastMealsForSlot", () => {
  const today = "2026-06-02";

  it("returns past instances of the slot, newest first, excluding today", () => {
    const logs = [
      mealLog("2026-06-02", [{ name: "Dinner", foods: [fi("Steak")] }]), // today
      mealLog("2026-06-01", [
        { name: "Dinner", foods: [fi("Pasta")] },
        { name: "Lunch", foods: [fi("Salad")] },
      ]),
      mealLog("2026-05-30", [{ name: "Dinner", foods: [fi("Curry")] }]),
    ];
    const r = pastMealsForSlot(logs, "Dinner", { todayKey: today });
    expect(r.map((p) => p.date)).toEqual(["2026-06-01", "2026-05-30"]);
    expect(r[0].foods[0].name).toBe("Pasta");
  });

  it("matches the slot name case-insensitively and skips empty slots", () => {
    const logs = [
      mealLog("2026-06-01", [{ name: "dinner", foods: [fi("Pasta")] }]),
      mealLog("2026-05-31", [{ name: "Dinner", foods: [] }]), // empty → skip
    ];
    const r = pastMealsForSlot(logs, "Dinner", { todayKey: today });
    expect(r.map((p) => p.date)).toEqual(["2026-06-01"]);
  });

  it("excludes days outside the window and today/future", () => {
    const logs = [
      mealLog("2026-04-01", [{ name: "Dinner", foods: [fi("Old")] }]), // >30d
      mealLog("2026-06-10", [{ name: "Dinner", foods: [fi("Future")] }]),
      mealLog("2026-06-01", [{ name: "Dinner", foods: [fi("Good")] }]),
    ];
    const r = pastMealsForSlot(logs, "Dinner", { todayKey: today });
    expect(r.map((p) => p.foods[0].name)).toEqual(["Good"]);
  });

  it("caps at the limit, newest first", () => {
    const logs = Array.from({ length: 8 }, (_, i) =>
      mealLog(`2026-05-2${i + 2}`, [{ name: "Dinner", foods: [fi(`D${i}`)] }]),
    );
    const r = pastMealsForSlot(logs, "Dinner", { todayKey: today, limit: 3 });
    expect(r).toHaveLength(3);
    expect(r[0].date).toBe("2026-05-29");
  });
});
