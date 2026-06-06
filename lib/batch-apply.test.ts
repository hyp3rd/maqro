import type { FoodItem, Meal } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  enumerateDateRange,
  filterByDayOfWeek,
  scaffoldBatchDay,
} from "./batch-apply";

function food(id: number): FoodItem {
  return {
    id,
    name: `Food ${id}`,
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    portionSize: 100,
  };
}

function meal(id: number, name: string, foods: FoodItem[]): Meal {
  return { id, name, foods };
}

describe("enumerateDateRange", () => {
  it("returns inclusive list when start equals end", () => {
    expect(enumerateDateRange("2026-05-21", "2026-05-21")).toEqual([
      "2026-05-21",
    ]);
  });

  it("returns a five-day window for Mon→Fri", () => {
    expect(enumerateDateRange("2026-05-18", "2026-05-22")).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(enumerateDateRange("2026-05-30", "2026-06-02")).toEqual([
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    ]);
  });

  it("returns empty when start is after end", () => {
    expect(enumerateDateRange("2026-05-22", "2026-05-18")).toEqual([]);
  });

  it("caps at 366 days for safety", () => {
    const out = enumerateDateRange("2026-01-01", "2030-12-31");
    expect(out.length).toBe(366);
  });
});

describe("filterByDayOfWeek", () => {
  // 2026-05-18 is a Monday.
  const week = [
    "2026-05-18", // Mon = 1
    "2026-05-19", // Tue = 2
    "2026-05-20", // Wed = 3
    "2026-05-21", // Thu = 4
    "2026-05-22", // Fri = 5
    "2026-05-23", // Sat = 6
    "2026-05-24", // Sun = 0
  ];

  it("keeps only weekdays when given Mon–Fri", () => {
    expect(filterByDayOfWeek(week, new Set([1, 2, 3, 4, 5]))).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
    ]);
  });

  it("returns input unchanged when all seven DOWs are allowed", () => {
    expect(filterByDayOfWeek(week, new Set([0, 1, 2, 3, 4, 5, 6]))).toEqual(
      week,
    );
  });

  it("returns empty when nothing matches", () => {
    expect(filterByDayOfWeek(week, new Set())).toEqual([]);
  });
});

describe("addDays", () => {
  it("advances by one across a month boundary", () => {
    expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  });
  it("moves backwards with a negative offset", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("handles a one-week add", () => {
    expect(addDays("2026-05-21", 7)).toBe("2026-05-28");
  });
});

describe("dayOfWeek", () => {
  it("returns Sunday=0 through Saturday=6", () => {
    expect(dayOfWeek("2026-05-24")).toBe(0); // Sun
    expect(dayOfWeek("2026-05-18")).toBe(1); // Mon
    expect(dayOfWeek("2026-05-23")).toBe(6); // Sat
  });
});

describe("scaffoldBatchDay", () => {
  const fallback = [
    meal(1, "Breakfast", [food(10)]),
    meal(2, "Lunch", [food(11)]),
    meal(3, "Dinner", [food(12)]),
  ];

  it("keeps an existing day's meals untouched", () => {
    const existing = [meal(1, "Breakfast", [food(99)])];
    expect(scaffoldBatchDay(existing, fallback)).toBe(existing);
  });

  it("scaffolds a new day with the fallback layout but EMPTY foods", () => {
    // The bug: a new day used to inherit a COPY of today's foods, so a recipe
    // batch-applied to one slot pasted the whole day onto every target and
    // doubled the target slot. The scaffold must carry the layout only.
    const result = scaffoldBatchDay(null, fallback);
    expect(result.map((m) => [m.id, m.name])).toEqual([
      [1, "Breakfast"],
      [2, "Lunch"],
      [3, "Dinner"],
    ]);
    expect(result.every((m) => m.foods.length === 0)).toBe(true);
  });
});
