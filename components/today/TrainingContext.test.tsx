/**
 * @vitest-environment jsdom
 */
import { countDateFormats } from "@/lib/i18n/date-format-counter";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { targetsForDate, weekTargets } from "@maqro/core/targets";
import type { PersonalInfo } from "@maqro/core/types";
import { cleanup, render, screen } from "@testing-library/react";
import { TrainingContext } from "./TrainingContext";

afterEach(() => cleanup());

const PROFILE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  manualTdee: 2600,
  units: "metric",
  training: {
    enabled: true,
    cycling: "modest",
    // Sunday first: Wednesday 21 Oct 2026 is a hard lower day at 18:00.
    days: [
      { type: "rest" },
      { type: "rest" },
      { type: "rest" },
      { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
      { type: "rest" },
      { type: "rest" },
      { type: "rest" },
    ],
  },
};

const ctx = { phasesEnabled: false };
const TODAY = "2026-10-24";

function context(date: string) {
  return (
    <TrainingContext
      day={targetsForDate(PROFILE, date, ctx)}
      week={weekTargets(PROFILE, date, ctx)}
      today={TODAY}
    />
  );
}

describe("TrainingContext", () => {
  it("builds its weekday formatter once per locale, not on every render", () => {
    let rerender: ReturnType<typeof render>["rerender"] = () => {};
    const first = countDateFormats(() => {
      rerender = render(context("2026-10-21"), {
        wrapper: intlWrapper(),
      }).rerender;
    });
    const again = countDateFormats(() => rerender(context("2026-10-21")));
    expect(first).toBe(1);
    expect(again).toBe(0);
    // The formatter names a day further back than yesterday.
    expect(screen.getByText(/on Wednesday/)).toBeTruthy();
  });
});
