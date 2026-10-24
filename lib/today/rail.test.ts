import { describe, expect, it } from "vitest";
import type { FoodItem, Meal } from "@maqro/core/types";
import { railNodes } from "./rail";
import type { RelativeDay } from "./timeline";

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

  /** Where the rail puts "Next to log", or -1. */
  const nextIndex = (meals: readonly Meal[], when: RelativeDay) =>
    railNodes(meals, when).findIndex((n) => n.next);

  it("today: filled for logged meals, the next slot to log, open after it", () => {
    expect(railNodes(day, "today")).toEqual([
      { node: "logged", next: false, lineStrong: true },
      { node: "logged", next: false, lineStrong: false },
      { node: "open", next: true, lineStrong: false },
      { node: "open", next: false, lineStrong: false },
    ]);
  });

  it("today: a skipped slot before a logged one stays open, not next", () => {
    const skipped = [
      meal(1, "Breakfast", false),
      meal(2, "Lunch", true),
      meal(3, "Dinner", false),
      meal(4, "Snacks", false),
    ];
    expect(railNodes(skipped, "today").map((n) => n.node)).toEqual([
      "open",
      "logged",
      "open",
      "open",
    ]);
    expect(nextIndex(skipped, "today")).toBe(2);
  });

  it("today: the first slot is next on an empty day, none once all are logged", () => {
    const empty = day.map((m) => ({ ...m, foods: [] }));
    expect(nextIndex(empty, "today")).toBe(0);
    const full = day.map((m) => ({ ...m, foods: [FOOD] }));
    expect(nextIndex(full, "today")).toBe(-1);
  });

  it("today: a meal with no logged time is planned, not logged", () => {
    const plan = [
      meal(1, "Breakfast", true),
      planned(2, "Lunch"),
      planned(3, "Dinner"),
      meal(4, "Snacks", false),
    ];
    expect(railNodes(plan, "today")).toEqual([
      { node: "logged", next: false, lineStrong: false },
      // Still ahead: the line past a planned slot stays faint. Planned food
      // isn't logged, so the first planned slot is the next one to log.
      { node: "planned", next: true, lineStrong: false },
      { node: "planned", next: false, lineStrong: false },
      { node: "open", next: false, lineStrong: false },
    ]);
  });

  it("today: next to log is the first slot after the last LOGGED one", () => {
    // Auto-filled ahead of the day, breakfast eaten and logged.
    const plan = [
      meal(1, "Breakfast", true),
      planned(2, "Lunch"),
      meal(3, "Dinner", false),
      planned(4, "Snacks"),
    ];
    expect(nextIndex(plan, "today")).toBe(1);
    // Nothing logged yet: the day starts at its first slot, planned or not.
    const untouched = day.map((m) => planned(m.id, m.name));
    expect(nextIndex(untouched, "today")).toBe(0);
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
      { node: "logged", next: false, lineStrong: false },
      { node: "open", next: false, lineStrong: false },
    ]);
  });

  it("past and future days have no next slot", () => {
    expect(railNodes(day, "past").map((n) => n.node)).toEqual([
      "logged",
      "logged",
      "open",
      "open",
    ]);
    expect(nextIndex(day, "past")).toBe(-1);
    expect(nextIndex(day, "future")).toBe(-1);
  });
});
