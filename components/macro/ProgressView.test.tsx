/**
 * @vitest-environment jsdom
 */
import type { GoalPhase } from "@/components/macro/types";
import {
  clearAllStores,
  saveDailyLog,
  saveWeightEntry,
  setWaterTotal,
  todayKey,
} from "@/lib/db";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@maqro/core/date";
import { cleanup, render, screen } from "@testing-library/react";
import { ProgressView } from "./ProgressView";

// Pro, so the phase markers and the per-phase maintenance reads are on: the
// code path that reads `goalPhases[].startDate`.
vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: { status: "ok", data: { tier: "pro" } } }),
  useTier: () => ({ tier: "pro", resolved: true }),
}));

const BASE = {
  targetCalories: 2000,
  targetCaloriesForDate: () => 2000,
  formulaTdee: 2400,
  dailyDelta: -400,
  goal: "lose" as const,
  gender: "male" as const,
  heightCm: 180,
  units: "metric" as const,
  onApplyTdee: vi.fn(),
  waterGoalMl: 2500,
  waterGoalOverride: null,
  onSetWaterGoal: vi.fn(),
  fasting: undefined,
  onApplyPhaseTdee: vi.fn(),
  onClearPhaseTdee: vi.fn(),
};

function food(calories: number) {
  return {
    id: 1,
    name: "Oats",
    protein: 10,
    carbs: 50,
    fat: 5,
    calories,
    portionSize: 100,
  };
}

beforeEach(async () => {
  // jsdom has no matchMedia; the chart's zoom wrapper reads the pointer type.
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  await clearAllStores();
  const today = todayKey();
  for (let i = 0; i < 5; i++) {
    const date = addDays(today, -i);
    await saveWeightEntry(date, 80 - i * 0.1);
    await saveDailyLog(date, [
      // Today 1800, then 1950 … 2400: three days past a 2000 kcal target.
      { id: 1, name: "Breakfast", foods: [food(1800 + i * 150)] },
    ]);
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProgressView", () => {
  it("renders when a synced phase has no start date, and still marks the valid ones", async () => {
    const today = todayKey();
    const goalPhases: GoalPhase[] = [
      // What a cleared <input type="date"> used to save.
      {
        id: "bad",
        kind: "leanBulk",
        startDate: "",
        durationWeeks: 4,
        weeklyRateKg: 0,
      },
      {
        id: "good",
        kind: "dietBreak",
        startDate: addDays(today, -2),
        durationWeeks: 2,
        weeklyRateKg: 0,
      },
    ];

    render(
      <ProgressView
        {...BASE}
        goalPhases={goalPhases}
      />,
    );

    expect(await screen.findByText("Calorie adherence")).toBeTruthy();
    // The valid phase still draws its boundary marker on the charts; the one
    // without a date is left off.
    expect(
      (await screen.findAllByText("Diet break", { selector: "text" })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("Lean bulk", { selector: "text" })).toEqual(
      [],
    );
  });

  it("draws daily calories as bars against the target, today in the signal colour", async () => {
    const { container } = render(<ProgressView {...BASE} />);
    const chart = await screen.findByRole("img", {
      name: /^Calories per day\. Bar chart, 5 entries/,
    });
    expect(chart.getAttribute("aria-label")).toMatch(/Target 2,000 kcal\./);
    expect(chart.querySelectorAll('[data-part="bar"]')).toHaveLength(5);
    expect(chart.querySelectorAll('[data-part="bar-over"]')).toHaveLength(3);
    expect(chart.querySelector('[data-part="target-line"]')).not.toBeNull();
    // Only today's bar carries the signal token.
    expect(
      container.querySelectorAll('[data-part="bar"].fill-signal'),
    ).toHaveLength(1);
  });

  it("draws plain bars with no target line while the profile has no target", async () => {
    render(
      <ProgressView
        {...BASE}
        targetCalories={0}
      />,
    );
    const chart = await screen.findByRole("img", {
      name: /^Calories per day\. Bar chart/,
    });
    expect(chart.getAttribute("aria-label")).not.toMatch(/Target/);
    expect(chart.querySelectorAll('[data-part="bar"]')).toHaveLength(5);
    // Not every day "over" a 0 kcal line.
    expect(chart.querySelectorAll('[data-part="bar-over"]')).toHaveLength(0);
    expect(chart.querySelector('[data-part="target-line"]')).toBeNull();
    expect(screen.queryByText(/0 kcal target/)).toBeNull();
  });

  describe("hydration chart", () => {
    beforeEach(async () => {
      const today = todayKey();
      await setWaterTotal(addDays(today, -1), 1500);
      await setWaterTotal(today, 2000);
    });

    it("plots millilitres for a metric profile", async () => {
      render(<ProgressView {...BASE} />);
      const chart = await screen.findByRole("img", {
        name: /^Water per day\. Line chart/,
      });
      const name = chart.getAttribute("aria-label") ?? "";
      expect(name).toContain("Lowest 1,500 ml, highest 2,000 ml");
      expect(name).toContain("Target 2,500 ml.");
      expect(screen.getByText("2.5 L goal", { selector: "text" })).toBeTruthy();
    });

    it("plots fluid ounces for an imperial profile, matching its goal", async () => {
      render(
        <ProgressView
          {...BASE}
          units="imperial"
        />,
      );
      const chart = await screen.findByRole("img", {
        name: /^Water per day\. Line chart/,
      });
      const name = chart.getAttribute("aria-label") ?? "";
      // 1500 ml = 50.7 fl oz, 2000 ml = 67.6, 2500 ml = 84.5: whole ounces,
      // as formatVolume shows the goal.
      expect(name).toContain("Lowest 51 fl oz, highest 68 fl oz");
      expect(name).toContain("Target 85 fl oz.");
      expect(name).not.toMatch(/\bml\b/);
      expect(
        screen.getByText("85 fl oz goal", { selector: "text" }),
      ).toBeTruthy();
      // The unit above the y axis is the same one.
      expect(
        [...chart.querySelectorAll("text")].map((t) => t.textContent),
      ).toContain("fl oz");
    });
  });
});
