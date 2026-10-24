import { describe, expect, it } from "vitest";
import type { Meal } from "@maqro/core/types";
import { STRIP_TICK, dayCalories, stripBar, weekStripDays } from "./week-strip";

describe("stripBar", () => {
  it("fills up to a fixed target tick, so every day's tick lines up", () => {
    expect(stripBar(1240, 2500)).toEqual({ fill: 0.496 * STRIP_TICK, nub: 0 });
    expect(stripBar(2500, 2500)).toEqual({ fill: STRIP_TICK, nub: 0 });
  });

  it("draws an overshoot as a nub past the tick, to scale, capped at the bar end", () => {
    const bar = stripBar(2060, 1950);
    expect(bar.fill).toBe(STRIP_TICK);
    expect(bar.nub).toBeCloseTo((110 / 1950) * STRIP_TICK, 10);
    expect(stripBar(5000, 1950).nub).toBeCloseTo(1 - STRIP_TICK, 10);
  });

  it("is empty without a target or intake", () => {
    expect(stripBar(800, 0)).toEqual({ fill: 0, nub: 0 });
    expect(stripBar(0, 2000)).toEqual({ fill: 0, nub: 0 });
    expect(stripBar(Number.NaN, 2000)).toEqual({ fill: 0, nub: 0 });
  });
});

describe("dayCalories", () => {
  it("sums every food across the day's meals", () => {
    const meals: Meal[] = [
      {
        id: 1,
        name: "Breakfast",
        foods: [
          {
            id: 1,
            name: "Oats",
            protein: 13,
            carbs: 67,
            fat: 7,
            calories: 389.4,
            portionSize: 100,
          },
        ],
      },
      {
        id: 2,
        name: "Lunch",
        foods: [
          {
            id: 2,
            name: "Rice",
            protein: 3,
            carbs: 28,
            fat: 0,
            calories: 130.2,
            portionSize: 100,
          },
        ],
      },
      { id: 3, name: "Dinner", foods: [] },
    ];
    expect(dayCalories(meals)).toBeCloseTo(519.6, 6);
    expect(dayCalories([])).toBe(0);
  });
});

describe("weekStripDays", () => {
  // A cycled week (each day its OWN target), Mon 19 → Sun 25 Oct 2026.
  const week = [
    { date: "2026-10-19", targetCalories: 2300 },
    { date: "2026-10-20", targetCalories: 1950 },
    { date: "2026-10-21", targetCalories: 2500 },
    { date: "2026-10-22", targetCalories: 1950 },
    { date: "2026-10-23", targetCalories: 2300 },
    { date: "2026-10-24", targetCalories: 2400 },
    { date: "2026-10-25", targetCalories: 1950 },
  ];
  const eaten = new Map([
    ["2026-10-19", 2280],
    ["2026-10-20", 2060.4],
    ["2026-10-21", 1240],
  ]);

  it("scores each day against its own target and places it in time", () => {
    const days = weekStripDays(week, eaten, "2026-10-21", "2026-10-21");
    expect(days.map((d) => [d.date, d.when, d.target, d.eaten])).toEqual([
      ["2026-10-19", "past", 2300, 2280],
      ["2026-10-20", "past", 1950, 2060],
      ["2026-10-21", "today", 2500, 1240],
      ["2026-10-22", "future", 1950, 0],
      ["2026-10-23", "future", 2300, 0],
      ["2026-10-24", "future", 2400, 0],
      ["2026-10-25", "future", 1950, 0],
    ]);
    // Monday is under (no nub); Tuesday's 110 over is a neutral "+110".
    expect(days[0]?.over).toBe(0);
    expect(days[0]?.bar.nub).toBe(0);
    expect(days[1]?.over).toBe(110);
    expect(days[1]?.bar.nub).toBeGreaterThan(0);
    expect(days[2]?.bar.fill).toBeCloseTo((1240 / 2500) * STRIP_TICK, 10);
  });

  it("marks the selected day, which need not be today", () => {
    const days = weekStripDays(week, eaten, "2026-10-21", "2026-10-20");
    expect(days.filter((d) => d.selected).map((d) => d.date)).toEqual([
      "2026-10-20",
    ]);
    expect(days.find((d) => d.when === "today")?.date).toBe("2026-10-21");
  });

  it("rounds before comparing, so the '+N' matches the figures", () => {
    const days = weekStripDays(
      [{ date: "2026-10-19", targetCalories: 1999.6 }],
      new Map([["2026-10-19", 2000.4]]),
      "2026-10-21",
      "2026-10-21",
    );
    expect(days[0]).toMatchObject({ target: 2000, eaten: 2000, over: 0 });
  });
});
