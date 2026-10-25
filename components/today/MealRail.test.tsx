/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Meal } from "@maqro/core/types";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MealRail } from "./MealRail";

afterEach(() => cleanup());

const DAY = "2026-10-21";
const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).getTime();
const food = (id: number, loggedAt?: number) => ({
  id,
  name: "food",
  protein: 0,
  carbs: 0,
  fat: 0,
  calories: 300,
  portionSize: 100,
  ...(loggedAt === undefined ? {} : { loggedAt }),
});
const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(1, at(7, 30))] },
  { id: 2, name: "Lunch", foods: [food(2)] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

function renderRail(today = DAY, meals = MEALS) {
  return render(
    <MealRail
      meals={meals}
      date={DAY}
      today={today}
      renderMeal={(meal) => <h3>{meal.name}</h3>}
    />,
  );
}

describe("MealRail", () => {
  it("lists every meal in order on the rail with its card", () => {
    renderRail();
    const list = screen.getByRole("list", { name: "Meals" });
    const items = within(list).getAllByRole("listitem");
    expect(
      items.map((li) => within(li).getByRole("heading").textContent),
    ).toEqual(["Breakfast", "Lunch", "Dinner", "Snacks"]);
  });

  it("fills logged meals, marks planned ones, highlights the next slot today", () => {
    const { container } = renderRail();
    const nodes = [...container.querySelectorAll("[data-node]")].map((n) =>
      n.getAttribute("data-node"),
    );
    // Lunch's food has no logged time (an auto-fill): planned, not logged —
    // so it, not the empty dinner after it, is the next slot to log.
    expect(nodes).toEqual(["logged", "planned", "open", "open"]);
    const next = container.querySelector("[data-next]");
    expect(next?.getAttribute("data-node")).toBe("planned");
    expect(next?.getAttribute("class")).toContain("border-dashed");
    expect(next?.getAttribute("class")).toContain("border-signal");
    expect(next?.getAttribute("class")).not.toContain("bg-foreground ");
    const lunch = screen.getAllByRole("listitem")[1] as HTMLElement;
    expect(within(lunch).getByText("Next to log")).toBeTruthy();
    expect(within(lunch).getByText("Planned, not logged yet")).toBeTruthy();
    expect(screen.getAllByText("Next to log")).toHaveLength(1);
  });

  it("lights an empty next slot in the signal colour", () => {
    const { container } = renderRail(DAY, [
      { id: 1, name: "Breakfast", foods: [food(1, at(7, 30))] },
      { id: 2, name: "Lunch", foods: [] },
    ]);
    const next = container.querySelector("[data-next]");
    expect(next?.getAttribute("data-node")).toBe("open");
    expect(next?.getAttribute("class")).toContain("bg-signal");
    const lunch = screen.getAllByRole("listitem")[1] as HTMLElement;
    expect(within(lunch).getByText("Next to log")).toBeTruthy();
  });

  it("shows when a meal was first logged, and no time for a planned one", () => {
    const { container } = renderRail();
    const times = [...container.querySelectorAll("[data-part=time]")].map(
      (t) => t.textContent,
    );
    expect(times).toEqual(["07:30", "", "", ""]);
  });

  it("reads a past day's untimed food as logged", () => {
    const { container } = renderRail("2026-10-23");
    const nodes = [...container.querySelectorAll("[data-node]")].map((n) =>
      n.getAttribute("data-node"),
    );
    expect(nodes).toEqual(["logged", "logged", "open", "open"]);
    expect(screen.queryByText("Planned, not logged yet")).toBeNull();
  });

  it("gives the time column back to the cards when no meal has a time", () => {
    const untimed: Meal[] = [
      { id: 1, name: "Breakfast", foods: [food(1)] },
      { id: 2, name: "Lunch", foods: [] },
    ];
    const { container } = renderRail(DAY, untimed);
    expect(container.querySelector("[data-part=time]")).toBeNull();
    for (const li of container.querySelectorAll("li")) {
      expect(li.getAttribute("class")).toContain(
        "grid-cols-[0.75rem_minmax(0,1fr)]",
      );
    }
  });

  it("has no next slot on another day", () => {
    const { container } = renderRail("2026-10-22");
    expect(container.querySelector("[data-next]")).toBeNull();
    expect(screen.queryByText("Next to log")).toBeNull();
  });
});
