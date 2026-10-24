/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Meal } from "./types";

// The recents strip reads IndexedDB; only the launcher's own steps matter.
vi.mock("./QuickAddFoods", () => ({ QuickAddFoods: () => null }));

const { LogMealSheet } = await import("./LogMealSheet");

const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
];

afterEach(() => {
  cleanup();
});

function renderSheet(initialMealId: number | null, aiAvailable = true) {
  const onMethod = vi.fn();
  render(
    <LogMealSheet
      open
      onOpenChange={() => {}}
      meals={MEALS}
      dayLabel="Today"
      aiAvailable={aiAvailable}
      initialMealId={initialMealId}
      onMethod={onMethod}
      onQuickLog={() => {}}
    />,
  );
  return { onMethod };
}

describe("LogMealSheet names its target", () => {
  it("pre-targeted: the title names the meal and the day", () => {
    renderSheet(2);
    expect(
      screen.getByRole("dialog", { name: "Add to Lunch · Today" }),
    ).toBeTruthy();
  });

  it("at the meal step: the title names the day", () => {
    renderSheet(null);
    expect(
      screen.getByRole("dialog", { name: "Log a meal · Today" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Breakfast/ }));
    expect(
      screen.getByRole("dialog", { name: "Add to Breakfast · Today" }),
    ).toBeTruthy();
  });

  it("Photo and Voice stay in the method step, AI-gated", () => {
    const { onMethod } = renderSheet(2);
    fireEvent.click(screen.getByRole("button", { name: /Photo/ }));
    expect(onMethod).toHaveBeenCalledWith("photo", 2);
    expect(screen.getByRole("button", { name: /Voice/ })).toBeTruthy();
    cleanup();
    renderSheet(2, false);
    expect(screen.queryByRole("button", { name: /Photo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Voice/ })).toBeNull();
  });
});
