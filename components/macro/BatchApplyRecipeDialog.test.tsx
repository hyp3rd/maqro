/**
 * @vitest-environment jsdom
 */
import { clearAllStores, listMealSchedules } from "@/lib/db";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BatchApplyRecipeDialog } from "./BatchApplyRecipeDialog";
import type { Meal, Recipe } from "./types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RECIPE: Recipe = {
  id: "r1",
  name: "Chickpea bowl",
  ingredients: [],
  createdAt: 0,
  updatedAt: 0,
};
const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
];

beforeEach(async () => {
  await clearAllStores();
});
afterEach(() => cleanup());

describe("BatchApplyRecipeDialog days of the week", () => {
  it("shows Monday first, defaults to Mon-Fri and saves getDay numbers", async () => {
    render(
      <BatchApplyRecipeDialog
        open
        onOpenChange={() => {}}
        recipe={RECIPE}
        currentMeals={MEALS}
      />,
    );

    const group = screen.getByRole("group", { name: "Days of the week" });
    const days = Array.from(group.querySelectorAll("button"));
    expect(days.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(days.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(async () => {
      const [saved] = await listMealSchedules();
      expect(saved?.daysOfWeek).toEqual([0, 2, 3, 4, 5]);
    });
  });
});
