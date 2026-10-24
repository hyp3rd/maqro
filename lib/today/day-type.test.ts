import { describe, expect, it } from "vitest";
import { dayTypeDescription, dayTypeLabel } from "./day-type";

describe("dayTypeLabel", () => {
  it("names the session and the kind of day it makes", () => {
    expect(
      dayTypeLabel({
        day: { type: "lower", intensity: "hard", time: "18:00" },
        dayClass: "heavy",
      }),
    ).toBe("Lower · heavy day");
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
    ).toBe("Lower, heavy day, 18:00, 75 min");
    expect(
      dayTypeDescription({ day: { type: "upper" }, dayClass: "training" }),
    ).toBe("Upper, training day");
    expect(
      dayTypeDescription({ day: { type: "rest" }, dayClass: "rest" }),
    ).toBe("Rest day");
  });
});
