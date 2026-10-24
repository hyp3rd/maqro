import { describe, expect, it } from "vitest";
import {
  mealSlotKind,
  quickAddMealId,
  slotKindAt,
} from "@maqro/core/quick-add";

/** Minutes since local midnight, e.g. `at(12, 30)` = 12:30. */
const at = (h: number, m = 0) => h * 60 + m;

const DEFAULT_DAY = [
  { id: 1, name: "Breakfast" },
  { id: 2, name: "Lunch" },
  { id: 3, name: "Dinner" },
  { id: 4, name: "Snacks" },
];

describe("slotKindAt", () => {
  it.each([
    [at(4), "breakfast"],
    [at(7, 15), "breakfast"],
    [at(10, 29), "breakfast"],
    [at(10, 30), "lunch"],
    [at(12), "lunch"],
    [at(14, 59), "lunch"],
    [at(15), "snack"],
    [at(16, 59), "snack"],
    [at(17), "dinner"],
    [at(19, 45), "dinner"],
    [at(21, 59), "dinner"],
    [at(22), "snack"],
    [at(23, 59), "snack"],
    [at(0), "snack"],
    [at(3, 59), "snack"],
  ] as const)("%i min → %s", (minute, kind) => {
    expect(slotKindAt(minute)).toBe(kind);
  });
});

describe("mealSlotKind", () => {
  it.each([
    ["Breakfast", "breakfast"],
    ["  brunch ", "breakfast"],
    ["Lunch", "lunch"],
    ["Dinner", "dinner"],
    ["Supper", "dinner"],
    ["Snacks", "snack"],
    ["Afternoon snack", "snack"],
    ["Meal 1", null],
    ["Pre-workout", null],
    ["", null],
  ] as const)("%j → %s", (name, kind) => {
    expect(mealSlotKind(name)).toBe(kind);
  });
});

describe("quickAddMealId", () => {
  it("morning → breakfast", () => {
    expect(quickAddMealId(DEFAULT_DAY, at(8))).toBe(1);
  });

  it("noon → lunch", () => {
    expect(quickAddMealId(DEFAULT_DAY, at(12))).toBe(2);
  });

  it("evening → dinner", () => {
    expect(quickAddMealId(DEFAULT_DAY, at(19, 30))).toBe(3);
  });

  it("afternoon and late night → snacks", () => {
    expect(quickAddMealId(DEFAULT_DAY, at(16))).toBe(4);
    expect(quickAddMealId(DEFAULT_DAY, at(23, 30))).toBe(4);
    expect(quickAddMealId(DEFAULT_DAY, at(1))).toBe(4);
  });

  it("matches renamed slots by name, in day order", () => {
    const day = [
      { id: 7, name: "Brunch" },
      { id: 8, name: "Morning snack" },
      { id: 9, name: "Afternoon snack" },
      { id: 10, name: "Supper" },
    ];
    expect(quickAddMealId(day, at(9))).toBe(7);
    // Two snack slots: the first one in the day's order wins.
    expect(quickAddMealId(day, at(15, 30))).toBe(8);
    expect(quickAddMealId(day, at(20))).toBe(10);
  });

  it("no slot of the time's kind → null (the launcher starts at the meal step)", () => {
    const day = [
      { id: 1, name: "Meal 1" },
      { id: 2, name: "Meal 2" },
      { id: 3, name: "Meal 3" },
    ];
    expect(quickAddMealId(day, at(12))).toBeNull();
    // A day without a snack slot does not fall back to another kind.
    expect(quickAddMealId(DEFAULT_DAY.slice(0, 3), at(23))).toBeNull();
    expect(quickAddMealId([], at(12))).toBeNull();
  });

  it("is deterministic for out-of-range and fractional minutes", () => {
    // 24:00 wraps to 00:00 (late night), -60 to 23:00, 12:30.9 floors.
    expect(quickAddMealId(DEFAULT_DAY, at(24))).toBe(4);
    expect(quickAddMealId(DEFAULT_DAY, -60)).toBe(4);
    expect(quickAddMealId(DEFAULT_DAY, at(12, 30) + 0.9)).toBe(2);
    expect(quickAddMealId(DEFAULT_DAY, Number.NaN)).toBeNull();
  });
});
