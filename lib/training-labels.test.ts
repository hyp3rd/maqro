import { describe, expect, it } from "vitest";
import {
  TRAINING_TYPE_LABEL,
  dayTypeDescription,
  dayTypeLabel,
  sessionDetails,
  sessionLabel,
} from "./training-labels";

describe("dayTypeLabel", () => {
  it("names the session and the kind of day it makes", () => {
    expect(
      dayTypeLabel({
        day: { type: "lower", intensity: "hard", time: "18:00" },
        dayClass: "heavy",
      }),
    ).toBe("Lower body · heavy day");
    expect(dayTypeLabel({ day: { type: "upper" }, dayClass: "training" })).toBe(
      "Upper body · training day",
    );
    expect(
      dayTypeLabel({ day: { type: "fullBody" }, dayClass: "training" }),
    ).toBe("Full body · training day");
    expect(
      dayTypeLabel({
        day: { type: "endurance", durationMin: 90 },
        dayClass: "endurance",
      }),
    ).toBe("Endurance · long day");
    expect(
      dayTypeLabel({
        day: { type: "hiit", intensity: "light" },
        dayClass: "light",
      }),
    ).toBe("HIIT · light day");
  });

  it("calls a rest day a rest day", () => {
    expect(dayTypeLabel({ day: { type: "rest" }, dayClass: "rest" })).toBe(
      "Rest day",
    );
  });

  it("uses the same session names as the editor's type picker", () => {
    for (const type of ["upper", "lower", "fullBody", "endurance"] as const) {
      expect(
        dayTypeLabel({ day: { type }, dayClass: "training" }).split(" · ")[0],
      ).toBe(TRAINING_TYPE_LABEL[type]);
    }
  });
});

describe("dayTypeDescription", () => {
  it("spells out the planned time and length for assistive tech", () => {
    expect(
      dayTypeDescription({
        day: {
          type: "lower",
          intensity: "hard",
          time: "18:00",
          durationMin: 75,
        },
        dayClass: "heavy",
      }),
    ).toBe("Lower body, heavy day, 18:00, 75 min");
    expect(
      dayTypeDescription({ day: { type: "upper" }, dayClass: "training" }),
    ).toBe("Upper body, training day");
    expect(
      dayTypeDescription({ day: { type: "rest" }, dayClass: "rest" }),
    ).toBe("Rest day");
  });
});

describe("sessionDetails / sessionLabel", () => {
  it("lists what the session has, keeping a duration together", () => {
    const day = {
      type: "lower",
      intensity: "hard",
      time: "18:00",
      durationMin: 75,
    } as const;
    expect(sessionDetails(day)).toBe("Hard · 18:00 · 75 min");
    expect(sessionLabel(day)).toBe("Lower body · Hard · 18:00 · 75 min");
  });

  it("a session without details is just its type; a rest day has none", () => {
    expect(sessionDetails({ type: "sport" })).toBe("No details yet");
    expect(sessionLabel({ type: "sport" })).toBe("Sport");
    expect(sessionDetails({ type: "rest" })).toBe("No session");
    expect(sessionLabel({ type: "rest" })).toBe("Rest day");
  });
});
