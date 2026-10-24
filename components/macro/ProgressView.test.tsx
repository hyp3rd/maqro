/**
 * @vitest-environment jsdom
 */
import type { GoalPhase } from "@/components/macro/types";
import {
  clearAllStores,
  saveBodyMeasurement,
  saveDailyLog,
  saveWeightEntry,
  setWaterTotal,
  todayKey,
} from "@/lib/db";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import type { ReactElement } from "react";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateBodyFat } from "@maqro/core/body-fat";
import { addDays } from "@maqro/core/date";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { ProgressView } from "./ProgressView";

/** The app renders every view inside the root layout's
 *  NextIntlClientProvider; its readouts (NumberTicker) read the locale. */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: intlWrapper() });

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

  it("sends people to the destinations the nav actually has", async () => {
    await clearAllStores();
    const { container } = render(<ProgressView {...BASE} />);
    expect(
      await screen.findByText(
        /^Update your weight in Profile \(You on a phone\) - /,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Auto-logs when you change your weight in/).textContent,
    ).toMatch(/in Profile \(You on a phone\)\.$/);
    expect(screen.getByText(/^Add foods in Today - /)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Calculator tab|Meal Plan/);
  });

  it("without training, compares the 7-day average with today's target", async () => {
    render(<ProgressView {...BASE} />);
    // 1800 … 2400 → a 2,100 kcal average: 105% of 2,000.
    expect(
      await screen.findByText(
        "Logged calories per day vs your current target of 2,000 kcal.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("105% of target")).toBeTruthy();
  });

  it("with a training week, compares averages with the weekly average, not today's planned day", async () => {
    // Today is a heavy day planned at 2,300; the week averages 2,000.
    render(
      <ProgressView
        {...BASE}
        targetCalories={2300}
        weeklyAverageCalories={2000}
      />,
    );
    expect(
      await screen.findByText(
        "Logged calories per day vs your weekly average target of 2,000 kcal.",
      ),
    ).toBeTruthy();
    // 2,100 / 2,000, not 2,100 / 2,300 (91%).
    expect(await screen.findByText("105% of target")).toBeTruthy();
    const chart = await screen.findByRole("img", {
      name: /^Calories per day\. Bar chart/,
    });
    expect(chart.getAttribute("aria-label")).toMatch(/Target 2,000 kcal\./);
    expect(screen.getByText("2000 kcal average")).toBeTruthy();
    expect(screen.queryByText(/2,?300/)).toBeNull();
  });

  describe("body fat (the same estimate the targets read)", () => {
    const expected = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 88,
      neckCm: 38,
    });
    const card = async () =>
      (await screen.findByText("Body fat", { selector: "p" })).parentElement;

    it("shows the latest complete reading when a newer one is waist-only", async () => {
      const today = todayKey();
      const older = addDays(today, -40);
      await saveBodyMeasurement(older, { waistCm: 88, neckCm: 38 });
      await saveBodyMeasurement(addDays(today, -2), { waistCm: 86 });
      render(<ProgressView {...BASE} />);

      expect(expected).not.toBeNull();
      const metric = await card();
      expect(metric?.textContent).toContain(`${expected?.toFixed(1)}%`);
      // It says which measurement the estimate comes from.
      const [y, m, d] = older.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      expect(metric?.textContent).toContain(`from ${label}`);
    });

    it("needs no date when the latest row is the reading", async () => {
      await saveBodyMeasurement(todayKey(), { waistCm: 88, neckCm: 38 });
      render(<ProgressView {...BASE} />);
      const metric = await card();
      expect(metric?.textContent).toContain(`${expected?.toFixed(1)}%`);
      expect(metric?.textContent).not.toContain("from ");
    });
  });

  describe("changes in the body are stated, never judged", () => {
    const JUDGED =
      /emerald|green|amber|red-|rose-|lime-|orange-|destructive|success|warning/;

    it("draws the waist change in a neutral colour, either way", async () => {
      const today = todayKey();
      await saveBodyMeasurement(addDays(today, -9), { waistCm: 88 });
      await saveBodyMeasurement(addDays(today, -2), { waistCm: 87 });
      render(<ProgressView {...BASE} />);
      const down = await screen.findByText(/↓ 1\.0 cm vs prev/);
      expect(down.className).toContain("text-muted-foreground");
      expect(down.className).not.toMatch(JUDGED);
      cleanup();

      await saveBodyMeasurement(today, { waistCm: 88.5 });
      render(<ProgressView {...BASE} />);
      const up = await screen.findByText(/↑ 1\.5 cm vs prev/);
      expect(up.className).toContain("text-muted-foreground");
      expect(up.className).not.toMatch(JUDGED);
    });

    it("draws the week's weight change in a neutral colour", async () => {
      render(<ProgressView {...BASE} />);
      // The seeded week: 79.6 kg four days ago → 80.0 kg today.
      const change = await screen.findByText(/^↑ 0\.4 kg$/);
      expect(change.className).toContain("text-muted-foreground");
      expect(change.className).not.toMatch(JUDGED);
    });
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
