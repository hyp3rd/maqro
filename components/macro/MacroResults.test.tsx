/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { targetsForDate } from "@maqro/core/targets";
import type { PersonalInfo } from "@maqro/core/types";
import { cleanup, render, screen } from "@testing-library/react";
import MacroResults from "./MacroResults";

afterEach(cleanup);

/** A cut: 2,600 kcal maintenance, −0.5 kg/week → a 2,050 kcal average. */
const BASE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "lose",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0.5,
  manualTdee: 2600,
  units: "metric",
};

/** Saturday 2026-10-24 is a hard lower-body day in this template. */
const TRAINING: PersonalInfo = {
  ...BASE,
  training: {
    enabled: true,
    cycling: "pronounced",
    days: [
      { type: "rest" },
      { type: "upper", intensity: "moderate" },
      { type: "rest" },
      { type: "fullBody", intensity: "moderate" },
      { type: "rest" },
      { type: "upper", intensity: "moderate" },
      { type: "lower", intensity: "hard" },
    ],
  },
};
const SATURDAY = "2026-10-24";
const TUESDAY = "2026-10-20";

const TOTALS = { protein: 0, carbs: 0, fat: 0, calories: 0 };

function renderResults(profile: PersonalInfo, date: string) {
  const values = targetsForDate(profile, date, { phasesEnabled: false });
  render(
    <MacroResults
      calculatedValues={values}
      totalMacros={TOTALS}
      units="metric"
    />,
    { wrapper: intlWrapper() },
  );
  return values;
}

describe("MacroResults without a training schedule", () => {
  it("renders exactly as before: no planned-day or average lines", () => {
    renderResults(BASE, SATURDAY);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/average/i);
    expect(text).not.toMatch(/planned/i);
    expect(screen.getByText("Deficit")).toBeTruthy();
    expect(document.body.textContent).toMatchInlineSnapshot(
      `"Daily TargetsBMR1,780kcal/dayTDEE2,600kcal/dayTarget2,050kcal/dayDeficit-550 kcal≈ 0.50 kg/wkMacro TargetsProtein205g820 kcalCarbs128g512 kcalFat80g720 kcalTodayProtein0g / 205gCarbs0g / 128gFat0g / 80gCalories0 / 2050Assumes ~7700 kcal/kg of bodyweight change. If your real-world rate diverges by more than ~20% after a few weeks, override TDEE in the form to recalibrate."`,
    );
  });
});

describe("MacroResults with a training schedule", () => {
  it("shows today's planned day and the weekly average", () => {
    const values = renderResults(TRAINING, SATURDAY);
    expect(values.training?.dayClass).toBe("heavy");
    const mean = values.training?.meanCalories ?? 0;
    expect(values.targetCalories).toBeGreaterThan(mean);
    expect(screen.getByText("Lower body · heavy day")).toBeTruthy();
    const summary = screen.getByTestId("planned-day");
    expect(summary.textContent).toContain(
      `${values.targetCalories.toLocaleString("en")} kcal planned today`,
    );
    expect(summary.textContent).toContain(
      `${mean.toLocaleString("en")} kcal weekly average`,
    );
  });

  it("projects the weekly change from the weekly average, not today's planned day", () => {
    const values = renderResults(TRAINING, TUESDAY);
    expect(values.training?.dayClass).toBe("rest");
    const mean = values.training?.meanCalories ?? 0;
    // The average's balance against maintenance drives the trend …
    expect(values.dailyDelta).toBe(mean - values.tdee);
    const weekly = ((Math.abs(mean - values.tdee) * 7) / 7700).toFixed(2);
    // … while a rest day's own (smaller) target would overstate it.
    const restDay = (
      (Math.abs(values.targetCalories - values.tdee) * 7) /
      7700
    ).toFixed(2);
    expect(restDay).not.toBe(weekly);
    expect(screen.getByText(`${weekly} kg/wk`, { exact: false })).toBeTruthy();
    expect(screen.getByText("Average deficit")).toBeTruthy();
  });
});
