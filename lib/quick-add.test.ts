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
    // Two snack slots: the afternoon one's name says it's the one for 15:30.
    expect(quickAddMealId(day, at(15, 30))).toBe(9);
    expect(quickAddMealId(day, at(20))).toBe(10);
  });

  describe("several snack slots: the one for the time of day", () => {
    const FIVE_MEALS = [
      { id: 1, name: "Breakfast" },
      { id: 2, name: "Morning snack" },
      { id: 3, name: "Lunch" },
      { id: 4, name: "Afternoon snack" },
      { id: 5, name: "Dinner" },
    ];

    it("15:30 → Afternoon snack, not the morning one", () => {
      expect(quickAddMealId(FIVE_MEALS, at(15, 30))).toBe(4);
    });

    it("late night with no evening snack → the latest snack slot", () => {
      // No slot after Dinner: the snack after the most recent main meal
      // falls back to the day's last snack, never the morning one.
      expect(quickAddMealId(FIVE_MEALS, at(23))).toBe(4);
      expect(quickAddMealId(FIVE_MEALS, at(2))).toBe(4);
    });

    it("an evening snack slot takes late night", () => {
      const day = [...FIVE_MEALS, { id: 6, name: "Evening snack" }];
      expect(quickAddMealId(day, at(15, 30))).toBe(4);
      expect(quickAddMealId(day, at(23))).toBe(6);
      expect(quickAddMealId(day, at(1))).toBe(6);
    });

    it.each([
      "Night snack",
      "Late-night snack",
      "Midnight snack",
      "Bedtime snack",
    ])("%j reads as late night", (name) => {
      const day = [...FIVE_MEALS, { id: 6, name }];
      expect(quickAddMealId(day, at(23))).toBe(6);
      expect(quickAddMealId(day, at(16))).toBe(4);
    });

    it("a time word inside another word is not a qualifier", () => {
      // "Chocolate" contains "late" but says nothing about the time.
      const day = [
        { id: 1, name: "Breakfast" },
        { id: 2, name: "Lunch" },
        { id: 3, name: "Chocolate snack" },
        { id: 4, name: "Dinner" },
        { id: 5, name: "Snack" },
      ];
      expect(quickAddMealId(day, at(15, 30))).toBe(3);
      expect(quickAddMealId(day, at(23))).toBe(5);
    });

    it("qualified names win even when listed out of order", () => {
      const day = [
        { id: 1, name: "Breakfast" },
        { id: 2, name: "Lunch" },
        { id: 3, name: "Dinner" },
        { id: 4, name: "Morning snack" },
        { id: 5, name: "Afternoon snack" },
      ];
      expect(quickAddMealId(day, at(15, 30))).toBe(5);
    });

    it("Snack 1 / Snack 2 between the meals → by position", () => {
      const day = [
        { id: 1, name: "Breakfast" },
        { id: 2, name: "Snack 1" },
        { id: 3, name: "Lunch" },
        { id: 4, name: "Snack 2" },
        { id: 5, name: "Dinner" },
      ];
      // 15:30: the snack after Lunch. 23:00: none after Dinner → the last.
      expect(quickAddMealId(day, at(15, 30))).toBe(4);
      expect(quickAddMealId(day, at(23))).toBe(4);

      const withEvening = [...day, { id: 6, name: "Snack 3" }];
      expect(quickAddMealId(withEvening, at(15, 30))).toBe(4);
      expect(quickAddMealId(withEvening, at(23))).toBe(6);
      expect(quickAddMealId(withEvening, at(1))).toBe(6);
    });

    it("Snack 1 / Snack 2 after every meal → the first after the latest meal begun", () => {
      const day = [
        { id: 1, name: "Breakfast" },
        { id: 2, name: "Lunch" },
        { id: 3, name: "Dinner" },
        { id: 4, name: "Snack 1" },
        { id: 5, name: "Snack 2" },
      ];
      expect(quickAddMealId(day, at(15, 30))).toBe(4);
      expect(quickAddMealId(day, at(23))).toBe(4);
    });

    it("a day missing the latest main meal anchors on the one before", () => {
      // No dinner slot: at 23:00 the most recent main meal on the day is
      // Lunch, so the snack after it.
      const day = [
        { id: 1, name: "Breakfast" },
        { id: 2, name: "Snack 1" },
        { id: 3, name: "Lunch" },
        { id: 4, name: "Snack 2" },
      ];
      expect(quickAddMealId(day, at(23))).toBe(4);
    });

    it("only snack slots → the first", () => {
      const day = [
        { id: 1, name: "Snack 1" },
        { id: 2, name: "Snack 2" },
      ];
      expect(quickAddMealId(day, at(15, 30))).toBe(1);
      expect(quickAddMealId(day, at(23))).toBe(1);
    });
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
