import { describe, expect, it } from "vitest";
import { targetsForDate } from "@maqro/core/targets";
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
  context: { phasesEnabled: boolean } = ctx,
) {
  return trainingContextLine(
    targetsForDate(profile, date, context),
    when,
    phrase,
  );
}

function withTraining(
  over: Partial<NonNullable<PersonalInfo["training"]>>,
): PersonalInfo {
  const template = PROFILE.training;
  if (!template) throw new Error("the fixture has a training week");
  return { ...PROFILE, training: { ...template, ...over } };
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
    expect(line("2026-10-21", withTraining({ cycling: "off" }))).toBeNull();
  });

  it("states only what the session changed when a goal phase starts mid-week", () => {
    // A cut (Pro) from Friday 23 Oct: Mon–Thu plan around maintenance,
    // Fri–Sun around the cut's lower mean. Saturday's long session moved
    // only its carbs; the phase's lower fat is not the session's doing.
    const phased: PersonalInfo = {
      ...withTraining({ cycling: "pronounced" }),
      goalPhases: [
        {
          id: "ph_cut",
          kind: "cut",
          startDate: "2026-10-23",
          durationWeeks: 4,
          weeklyRateKg: 0.5,
        },
      ],
    };
    const saturday = line("2026-10-24", phased, "today", "today", {
      phasesEnabled: true,
    });
    expect(saturday).toBe("Carbs are higher today for the long session");
    for (const date of ["2026-10-19", "2026-10-21", "2026-10-23"]) {
      expect(
        line(date, phased, "today", "today", { phasesEnabled: true }),
      ).toMatch(/^Carbs are higher today/);
    }
  });

  it("words a session that leaves the day under the weekly average", () => {
    // Monday's light session in a week of hard ones: its day sits under
    // the weekly average, so its carbs are lower than the average day's.
    const hardWeek = withTraining({
      days: [
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "light", time: "07:15" },
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "hard" },
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "hard" },
        { type: "rest" },
      ],
    });
    expect(line("2026-10-19", hardWeek)).toBe(
      "Carbs are lower today to match the light session at 07:15",
    );
    expect(line("2026-10-19", hardWeek, "past", "on Monday")).toBe(
      "Carbs were lower on Monday to match the light session at 07:15",
    );
    // Without a start time the line ends on the session.
    const untimed = withTraining({
      days: [
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "light" },
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "hard" },
        { type: "lower", intensity: "hard" },
        { type: "upper", intensity: "hard" },
        { type: "rest" },
      ],
    });
    expect(line("2026-10-19", untimed, "future", "on Monday")).toBe(
      "Carbs are lower on Monday to match the light session",
    );
  });

  it("says nothing with training off", () => {
    const off: PersonalInfo = { ...PROFILE, training: undefined };
    expect(line("2026-10-21", off)).toBeNull();
  });
});
