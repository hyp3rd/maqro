/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DailyTotals from "./DailyTotals";
import type { CalculatedValues } from "./types";

vi.mock("@/components/macro/StreakChip", () => ({ StreakChip: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
});

const TARGET: CalculatedValues = {
  bmr: 1780,
  tdee: 2600,
  targetCalories: 2600,
  dailyDelta: 0,
  requestedDelta: 0,
  protein: 195,
  carbs: 260,
  fat: 87,
};
const EATEN = { protein: 100, carbs: 150, fat: 50, calories: 2000 };

describe("DailyTotals remaining-kcal line", () => {
  it("today: kcal left today", () => {
    render(
      <DailyTotals
        calculatedValues={TARGET}
        totalMacros={EATEN}
        selectedDate="2026-06-10"
        today="2026-06-10"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("600 kcal left today");
  });

  it("a past day never says 'left today'", () => {
    render(
      <DailyTotals
        calculatedValues={TARGET}
        totalMacros={EATEN}
        selectedDate="2026-06-03"
        today="2026-06-10"
      />,
    );
    const line = screen.getByRole("status").textContent ?? "";
    expect(line).toBe("600 kcal under target");
    expect(line).not.toMatch(/today/i);
  });
});
