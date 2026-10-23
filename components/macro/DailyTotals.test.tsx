/**
 * @vitest-environment jsdom
 */
import type { CalculatedValues, TotalMacros } from "@/components/macro/types";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DailyTotals from "./DailyTotals";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => cleanup());

const TARGETS: CalculatedValues = {
  bmr: 1600,
  tdee: 2400,
  targetCalories: 2200,
  dailyDelta: -200,
  requestedDelta: -200,
  protein: 160,
  carbs: 200,
  fat: 70,
};

function renderTotals(totals: TotalMacros) {
  return render(
    <DailyTotals
      calculatedValues={TARGETS}
      totalMacros={totals}
      selectedDate="2026-10-20"
      today="2026-10-23"
    />,
  );
}

describe("DailyTotals", () => {
  it("draws one meter per macro against the day's targets", () => {
    renderTotals({ protein: 85, carbs: 120, fat: 40, calories: 1240 });
    const reading = (name: string) =>
      screen.getByRole("meter", { name }).getAttribute("aria-valuetext");
    expect(reading("Protein")).toBe("85 g of 160 g");
    expect(reading("Carbs")).toBe("120 g of 200 g");
    expect(reading("Fat")).toBe("40 g of 70 g");
    expect(reading("Calories")).toBe("1,240 kcal of 2,200 kcal");
  });

  it("shows 157% of carbs past the target tick, calmly, without clamping", () => {
    renderTotals({ protein: 150, carbs: 314, fat: 60, calories: 2300 });
    const carbs = screen.getByRole("meter", { name: "Carbs" });
    expect(carbs.getAttribute("aria-valuenow")).toBe("314");
    expect(carbs.getAttribute("aria-valuemax")).toBe("314");
    expect(carbs.getAttribute("aria-valuetext")).toBe(
      "314 g of 200 g, 114 g above target",
    );
    const tick = carbs.querySelector<HTMLElement>("[data-part=target]");
    const overflow = carbs.querySelector<HTMLElement>("[data-part=overflow]");
    expect(Number.parseFloat(tick?.style.left ?? "")).toBeCloseTo(
      (200 / 314) * 100,
      2,
    );
    expect(Number.parseFloat(overflow?.style.width ?? "")).toBeCloseTo(
      (114 / 314) * 100,
      2,
    );
    expect(overflow?.className).toContain("bg-macro-carbs/40");
    // A neutral "+N" next to the figure.
    expect(screen.getByText("+114").className).toContain(
      "text-muted-foreground",
    );
  });

  it("keeps over and under target neutral in the headline line", () => {
    const { container } = renderTotals({
      protein: 150,
      carbs: 314,
      fat: 60,
      calories: 2350,
    });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("150 kcal above target");
    expect(container.innerHTML).not.toMatch(/amber|emerald|red-|rose-/);
  });

  it("states a met target without a success colour", () => {
    const { container } = renderTotals({
      protein: 160,
      carbs: 200,
      fat: 70,
      calories: 2200,
    });
    expect(screen.getByRole("status").textContent).toBe("Daily target reached");
    expect(container.innerHTML).not.toMatch(/amber|emerald|red-|rose-/);
  });
});
