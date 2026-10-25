import { describe, expect, it } from "vitest";
import { targetsForDate, weekTargets } from "@maqro/core/targets";
import type { PersonalInfo } from "@maqro/core/types";
import { trainingContextLine } from "./training-context";

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
    // Sunday first.
    days: [
      { type: "rest" },
      { type: "upper", intensity: "moderate", time: "07:15", durationMin: 60 },
      { type: "rest" },
      { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
      { type: "rest" },
      { type: "fullBody", intensity: "moderate" },
      { type: "endurance", durationMin: 90 },
    ],
  },
};

const ctx = { phasesEnabled: false };

/** The line for `date` of the week of Mon 19 Oct 2026. */
function line(
  date: string,
  profile: PersonalInfo = PROFILE,
  when: "past" | "today" | "future" = "today",
  phrase = "today",
) {
  return trainingContextLine(
    targetsForDate(profile, date, ctx),
    weekTargets(profile, date, ctx),
    when,
    phrase,
  );
}

describe("trainingContextLine", () => {
  it("names the moved macro and the session with its start time", () => {
    // Wed: a hard lower-body session — a heavy day.
    expect(line("2026-10-21")).toBe(
      "Carbs are higher today — heavy session at 18:00",
    );
  });

  it("says nothing on a rest day", () => {
    expect(line("2026-10-20")).toBeNull();
  });

  it("words a session without a start time and another day", () => {
    // Fri: full body, no time — a planned day ahead.
    expect(line("2026-10-23", PROFILE, "future", "on Friday")).toBe(
      "Carbs are higher on Friday for the training session",
    );
  });

  it("speaks of a past day in the past tense", () => {
    expect(line("2026-10-19", PROFILE, "past", "on Monday")).toBe(
      "Carbs were higher on Monday — training session at 07:15",
    );
  });

  it("names fat when the diet moves fat instead of carbs", () => {
    const lowCarb: PersonalInfo = { ...PROFILE, dietType: "lowCarb" };
    expect(line("2026-10-21", lowCarb)).toBe(
      "Fat is higher today — heavy session at 18:00",
    );
  });

  it("says nothing when the day sits at the weekly average", () => {
    const template = PROFILE.training;
    if (!template) throw new Error("the fixture has a training week");
    const flat: PersonalInfo = {
      ...PROFILE,
      training: { ...template, cycling: "off" },
    };
    expect(line("2026-10-21", flat)).toBeNull();
  });

  it("says nothing with training off or no week to compare with", () => {
    const off: PersonalInfo = { ...PROFILE, training: undefined };
    expect(line("2026-10-21", off)).toBeNull();
    expect(
      trainingContextLine(
        targetsForDate(PROFILE, "2026-10-21", ctx),
        null,
        "today",
        "today",
      ),
    ).toBeNull();
  });
});
