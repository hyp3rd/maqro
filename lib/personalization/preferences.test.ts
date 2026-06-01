import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { extractFoodPreferences } from "./preferences";

function food(name: string): FoodItem {
  return {
    id: 1,
    name,
    protein: 10,
    carbs: 10,
    fat: 5,
    calories: 100,
    portionSize: 100,
  };
}

function meal(foods: FoodItem[]): Meal {
  return { id: 1, name: "Breakfast", foods };
}

function dailyLog(date: string, foodNames: string[]): DailyLog {
  return {
    date,
    meals: [meal(foodNames.map(food))],
    updatedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

describe("extractFoodPreferences", () => {
  it("returns an empty list for an empty log history", () => {
    expect(extractFoodPreferences([], { todayKey: "2026-05-26" })).toEqual([]);
  });

  it("counts food appearances across logs in the window", () => {
    const logs = [
      dailyLog("2026-05-20", ["Chicken breast", "White rice", "Banana"]),
      dailyLog("2026-05-21", ["Chicken breast", "White rice"]),
      dailyLog("2026-05-22", ["Chicken breast"]),
    ];
    const prefs = extractFoodPreferences(logs, { todayKey: "2026-05-26" });
    expect(prefs[0]).toEqual({ name: "Chicken breast", count: 3 });
    expect(prefs[1]).toEqual({ name: "White rice", count: 2 });
    expect(prefs[2]).toEqual({ name: "Banana", count: 1 });
  });

  it("ignores logs older than the lookback window", () => {
    const logs = [
      // 60 days old — should be ignored at the default 30-day window
      dailyLog("2026-03-27", ["Old food"]),
      dailyLog("2026-05-20", ["Recent food"]),
    ];
    const prefs = extractFoodPreferences(logs, { todayKey: "2026-05-26" });
    expect(prefs.map((p) => p.name)).toEqual(["Recent food"]);
  });

  it("respects an explicit windowDays override", () => {
    const logs = [dailyLog("2026-05-20", ["A"]), dailyLog("2026-05-21", ["B"])];
    const prefs = extractFoodPreferences(logs, {
      todayKey: "2026-05-26",
      // 3-day window — only the 24th onwards qualifies, both logs filtered out.
      windowDays: 3,
    });
    expect(prefs).toEqual([]);
  });

  it("respects the topN cap", () => {
    const logs = [
      dailyLog(
        "2026-05-20",
        Array.from({ length: 50 }, (_, i) => `Food ${i}`),
      ),
    ];
    const prefs = extractFoodPreferences(logs, {
      todayKey: "2026-05-26",
      topN: 5,
    });
    expect(prefs.length).toBe(5);
  });

  it("breaks ties alphabetically (deterministic prompt order)", () => {
    const logs = [dailyLog("2026-05-20", ["Tofu", "Apple", "Mango", "Beet"])];
    const prefs = extractFoodPreferences(logs, { todayKey: "2026-05-26" });
    expect(prefs.map((p) => p.name)).toEqual([
      "Apple",
      "Beet",
      "Mango",
      "Tofu",
    ]);
  });

  it("skips malformed entries (missing meals / foods / names)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs: any[] = [
      // Whole log missing meals array.
      { date: "2026-05-20" },
      // Meal missing foods array.
      { date: "2026-05-21", meals: [{ id: 1, name: "Breakfast" }] },
      // Food with no name field.
      {
        date: "2026-05-22",
        meals: [{ id: 1, name: "Breakfast", foods: [{ id: 1 }] }],
      },
      // Food with empty-string name after trim — should be skipped.
      {
        date: "2026-05-23",
        meals: [{ id: 1, name: "Breakfast", foods: [{ id: 1, name: "   " }] }],
      },
      // One valid entry to prove we didn't bail out on the first bad one.
      dailyLog("2026-05-24", ["Real food"]),
    ];
    const prefs = extractFoodPreferences(logs, { todayKey: "2026-05-26" });
    expect(prefs).toEqual([{ name: "Real food", count: 1 }]);
  });

  it("trims surrounding whitespace before counting (same string in/out)", () => {
    const logs = [dailyLog("2026-05-20", ["Chicken  ", "  Chicken"])];
    const prefs = extractFoodPreferences(logs, { todayKey: "2026-05-26" });
    // Both entries normalize to "Chicken" via trim — one bucket, count = 2.
    expect(prefs).toEqual([{ name: "Chicken", count: 2 }]);
  });
});
