import type { Meal } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  appendRecipeToNamedSlot,
  clampBatchDays,
  extraDatesFromToday,
} from "./meal-prep-batch";

describe("clampBatchDays", () => {
  it("clamps within 1..7", () => {
    expect(clampBatchDays(0)).toBe(1);
    expect(clampBatchDays(1)).toBe(1);
    expect(clampBatchDays(7)).toBe(7);
    expect(clampBatchDays(100)).toBe(7);
    expect(clampBatchDays(-5)).toBe(1);
  });

  it("floors fractional input and rejects NaN", () => {
    expect(clampBatchDays(3.7)).toBe(3);
    expect(clampBatchDays(Number.NaN)).toBe(1);
    expect(clampBatchDays(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("extraDatesFromToday", () => {
  it("returns [] for totalDays <= 1", () => {
    expect(extraDatesFromToday(1, new Date(2026, 4, 26))).toEqual([]);
    expect(extraDatesFromToday(0, new Date(2026, 4, 26))).toEqual([]);
    expect(extraDatesFromToday(-3, new Date(2026, 4, 26))).toEqual([]);
  });

  it("walks N-1 days forward from today, formatted as YYYY-MM-DD", () => {
    const today = new Date(2026, 4, 26); // May = month index 4
    expect(extraDatesFromToday(3, today)).toEqual(["2026-05-27", "2026-05-28"]);
  });

  it("crosses a month boundary cleanly", () => {
    const today = new Date(2026, 0, 30); // Jan 30
    expect(extraDatesFromToday(4, today)).toEqual([
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("caps at MAX_BATCH_DAYS - 1 even when asked for more", () => {
    const today = new Date(2026, 4, 26);
    // 99 → clamps to 7 → 6 extra dates.
    expect(extraDatesFromToday(99, today)).toHaveLength(6);
  });
});

function meal(id: number, name: string, foods: Meal["foods"] = []): Meal {
  return { id, name, foods };
}

const SAMPLE_FOOD: Meal["foods"][number] = {
  id: 999,
  name: "Chicken",
  protein: 30,
  carbs: 0,
  fat: 4,
  calories: 165,
  portionSize: 100,
};

describe("appendRecipeToNamedSlot", () => {
  it("appends to the named slot, leaves siblings untouched", () => {
    const meals = [
      meal(1, "Breakfast", [{ ...SAMPLE_FOOD, id: 1, name: "Oats" }]),
      meal(2, "Lunch"),
      meal(3, "Dinner"),
    ];
    const result = appendRecipeToNamedSlot(meals, "Lunch", [SAMPLE_FOOD]);
    expect(result).not.toBeNull();
    expect(result?.[0].foods.map((f) => f.name)).toEqual(["Oats"]);
    expect(result?.[1].foods.map((f) => f.name)).toEqual(["Chicken"]);
    expect(result?.[2].foods).toEqual([]);
  });

  it("appends to the END of an existing slot, doesn't replace", () => {
    const meals = [
      meal(1, "Lunch", [{ ...SAMPLE_FOOD, id: 1, name: "Salad" }]),
    ];
    const result = appendRecipeToNamedSlot(meals, "Lunch", [SAMPLE_FOOD]);
    expect(result?.[0].foods.map((f) => f.name)).toEqual(["Salad", "Chicken"]);
  });

  it("returns null when no slot matches the name", () => {
    const meals = [meal(1, "Breakfast"), meal(2, "Lunch")];
    const result = appendRecipeToNamedSlot(meals, "Brunch", [SAMPLE_FOOD]);
    expect(result).toBeNull();
  });

  it("is case-sensitive — slot names are user-controlled but stable", () => {
    const meals = [meal(1, "Lunch")];
    expect(appendRecipeToNamedSlot(meals, "lunch", [SAMPLE_FOOD])).toBeNull();
  });

  it("does not mutate the input array", () => {
    const original = [meal(1, "Lunch")];
    const result = appendRecipeToNamedSlot(original, "Lunch", [SAMPLE_FOOD]);
    expect(original[0].foods).toEqual([]);
    expect(result?.[0].foods).toHaveLength(1);
  });
});
