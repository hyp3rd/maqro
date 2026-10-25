import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import { railNodes } from "./rail";

/** Food as intent, with no logged time: an AI auto-fill, a template, the
 *  demo's later meals. */
const PLANNED_FOOD: FoodItem = {
  id: 1,
  name: "Oats",
  protein: 13,
  carbs: 67,
  fat: 7,
  calories: 389,
  portionSize: 100,
};
/** The same food logged as eaten (it carries the time it was logged). */
const FOOD: FoodItem = {
  ...PLANNED_FOOD,
  loggedAt: new Date(2026, 9, 21, 7, 30).getTime(),
};

const meal = (id: number, name: string, logged: boolean): Meal => ({
  id,
  name,
  foods: logged ? [FOOD] : [],
});
const planned = (id: number, name: string): Meal => ({
  id,
  name,
  foods: [PLANNED_FOOD],
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

  it("today: a meal with no logged time is planned, not logged", () => {
    const plan = [
      meal(1, "Breakfast", true),
      planned(2, "Lunch"),
      planned(3, "Dinner"),
      meal(4, "Snacks", false),
    ];
    expect(railNodes(plan, "today")).toEqual([
      { node: "logged", lineStrong: false },
      // Still ahead: the line past a planned slot stays faint.
      { node: "planned", lineStrong: false },
      { node: "planned", lineStrong: false },
      // The next empty slot after the day's food.
      { node: "now", lineStrong: false },
    ]);
  });

  it("a fully auto-filled day reads as planned throughout", () => {
    const plan = day.map((m) => planned(m.id, m.name));
    for (const when of ["today", "future"] as const) {
      expect(railNodes(plan, when).map((n) => n.node)).toEqual([
        "planned",
        "planned",
        "planned",
        "planned",
      ]);
    }
  });

  it("one timed food makes the meal logged", () => {
    const mixed: Meal = { id: 1, name: "Lunch", foods: [PLANNED_FOOD, FOOD] };
    expect(railNodes([mixed], "today")[0]?.node).toBe("logged");
  });

  it("a past day's untimed food reads as logged (it can't carry a time)", () => {
    expect(
      railNodes([planned(1, "Breakfast"), meal(2, "Lunch", false)], "past"),
    ).toEqual([
      { node: "logged", lineStrong: false },
      { node: "open", lineStrong: false },
    ]);
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
