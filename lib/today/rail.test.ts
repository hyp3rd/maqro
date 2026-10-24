import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import { railNodes } from "./rail";

const FOOD: FoodItem = {
  id: 1,
  name: "Oats",
  protein: 13,
  carbs: 67,
  fat: 7,
  calories: 389,
  portionSize: 100,
};
const meal = (id: number, name: string, logged: boolean): Meal => ({
  id,
  name,
  foods: logged ? [FOOD] : [],
});

describe("railNodes", () => {
  const day = [
    meal(1, "Breakfast", true),
    meal(2, "Lunch", true),
    meal(3, "Dinner", false),
    meal(4, "Snacks", false),
  ];

  it("today: filled for logged meals, 'now' for the next slot, open after it", () => {
    expect(railNodes(day, "today")).toEqual([
      { node: "logged", lineStrong: true },
      { node: "logged", lineStrong: false },
      { node: "now", lineStrong: false },
      { node: "open", lineStrong: false },
    ]);
  });

  it("today: a skipped slot before a logged one stays open, not 'now'", () => {
    const skipped = [
      meal(1, "Breakfast", false),
      meal(2, "Lunch", true),
      meal(3, "Dinner", false),
      meal(4, "Snacks", false),
    ];
    expect(railNodes(skipped, "today").map((n) => n.node)).toEqual([
      "open",
      "logged",
      "now",
      "open",
    ]);
  });

  it("today: the first slot is 'now' on an empty day, none once all are logged", () => {
    const empty = day.map((m) => ({ ...m, foods: [] }));
    expect(railNodes(empty, "today")[0]?.node).toBe("now");
    const full = day.map((m) => ({ ...m, foods: [FOOD] }));
    expect(railNodes(full, "today").some((n) => n.node === "now")).toBe(false);
  });

  it("past and future days have no 'now'", () => {
    expect(railNodes(day, "past").map((n) => n.node)).toEqual([
      "logged",
      "logged",
      "open",
      "open",
    ]);
    expect(railNodes(day, "future").some((n) => n.node === "now")).toBe(false);
  });
});
