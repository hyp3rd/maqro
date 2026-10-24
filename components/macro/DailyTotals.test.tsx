/**
 * @vitest-environment jsdom
 */
import type { CalculatedValues, TotalMacros } from "@/components/macro/types";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DailyTotals from "./DailyTotals";

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  window.localStorage.clear();
  toast.mockClear();
  toast.success.mockClear();
});
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
    { wrapper: intlWrapper() },
  );
}

/** Each readout row's text, whitespace-collapsed ("Protein85 / 160 g…"). */
function readout(label: string): string {
  const term = screen
    .getAllByRole("term")
    .find((dt) => dt.textContent === label);
  return (term?.parentElement?.textContent ?? "").replace(/\s+/g, " ");
}

describe("DailyTotals", () => {
  it("reads energy and each macro against the day's targets beside the gauge", () => {
    const { container } = renderTotals({
      protein: 85,
      carbs: 120,
      fat: 40,
      calories: 1240,
    });
    expect(readout("Eaten")).toBe("Eaten1,240 / 2,200 kcal");
    expect(readout("Protein")).toBe("Protein85 / 160 g75 g left");
    expect(readout("Carbs")).toBe("Carbs120 / 200 g80 g left");
    expect(readout("Fat")).toBe("Fat40 / 70 g30 g left");
    // The gauge draws the same four readings.
    for (const ring of ["energy", "protein", "carbs", "fat"]) {
      expect(
        container.querySelector(`[data-ring="${ring}"][data-part="solid"]`),
      ).not.toBeNull();
    }
  });

  it("shows 157% of carbs past the target, calmly, without clamping", () => {
    const { container } = renderTotals({
      protein: 150,
      carbs: 314,
      fat: 60,
      calories: 2300,
    });
    expect(readout("Carbs")).toBe("Carbs314 / 200 g+114 g");
    expect(screen.getByText("+114 g").className).toContain(
      "text-muted-foreground",
    );
    // The carbs arc completes its lap and carries on, same hue at 40%.
    const over = container.querySelector(
      '[data-ring="carbs"][data-part="over"]',
    );
    expect(over?.getAttribute("class")).toContain("stroke-macro-carbs/40");
  });

  it("keeps over and under target neutral in the headline", () => {
    const { container } = renderTotals({
      protein: 150,
      carbs: 314,
      fat: 60,
      calories: 2350,
    });
    expect(screen.getByRole("status").textContent).toBe("150 kcal over");
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
      { wrapper: intlWrapper() },
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
      { wrapper: intlWrapper() },
    );
    const line = screen.getByRole("status").textContent ?? "";
    expect(line).toBe("600 kcal under target");
    expect(line).not.toMatch(/today/i);
  });

  it("a future day being planned ahead has kcal to plan", () => {
    render(
      <DailyTotals
        calculatedValues={TARGET}
        totalMacros={EATEN}
        selectedDate="2026-06-12"
        today="2026-06-10"
      />,
      { wrapper: intlWrapper() },
    );
    expect(screen.getByRole("status").textContent).toBe("600 kcal to plan");
    // Its readout says the same: what is logged ahead is planned.
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.queryByText("Eaten")).toBeNull();
  });
});

describe("DailyTotals target-reached note", () => {
  it("notes reaching today's target once, neutrally, without praise", () => {
    const props = {
      calculatedValues: TARGET,
      totalMacros: { ...EATEN, calories: 2650 },
      selectedDate: "2026-06-10",
      today: "2026-06-10",
    };
    const { rerender } = render(<DailyTotals {...props} />, {
      wrapper: intlWrapper(),
    });
    rerender(
      <DailyTotals
        {...props}
        totalMacros={{ ...EATEN, calories: 2700 }}
      />,
    );
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Today's calorie target reached");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("never fires for a past day", () => {
    render(
      <DailyTotals
        calculatedValues={TARGET}
        totalMacros={{ ...EATEN, calories: 2650 }}
        selectedDate="2026-06-03"
        today="2026-06-10"
      />,
      { wrapper: intlWrapper() },
    );
    expect(toast).not.toHaveBeenCalled();
  });
});
