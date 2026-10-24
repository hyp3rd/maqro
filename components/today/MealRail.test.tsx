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

function renderRail(today = DAY) {
  return render(
    <MealRail
      meals={MEALS}
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

  it("fills logged meals, highlights the next slot today, leaves the rest hollow", () => {
    const { container } = renderRail();
    const nodes = [...container.querySelectorAll("[data-node]")].map((n) =>
      n.getAttribute("data-node"),
    );
    expect(nodes).toEqual(["logged", "logged", "now", "open"]);
    expect(
      container.querySelector("[data-node=now]")?.getAttribute("class"),
    ).toContain("bg-signal");
    expect(screen.getByText("Next to log")).toBeTruthy();
  });

  it("shows when a meal was first logged, and nothing for an untimed one", () => {
    const { container } = renderRail();
    const times = [...container.querySelectorAll("[data-part=time]")].map(
      (t) => t.textContent,
    );
    expect(times).toEqual(["07:30", "", "", ""]);
  });

  it("has no 'now' slot on another day", () => {
    const { container } = renderRail("2026-10-22");
    expect(container.querySelector("[data-node=now]")).toBeNull();
  });
});
