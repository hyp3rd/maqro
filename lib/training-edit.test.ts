import { describe, expect, it } from "vitest";
import {
  normalizeProteinSetting,
  normalizeTrainingSchedule,
} from "@maqro/core/training";
import {
  defaultTrainingSchedule,
  withProteinSetting,
  withTrainingCycling,
  withTrainingDay,
  withTrainingEnabled,
} from "@maqro/core/training-edit";

/** A template written by a NEWER client: a session type and keys this
 *  build doesn't know. Reads normalize them away; edits must not. */
const FROM_NEWER_CLIENT = {
  enabled: false,
  cycling: "aggressive",
  futureFlag: { keep: true },
  days: [
    { type: "rest" },
    { type: "upper", intensity: "hard", time: "18:00", durationMin: 60 },
    { type: "yoga", durationMin: 30 },
    { type: "lower", intensity: "moderate", note: "squats" },
    { type: "rest" },
    { type: "fullBody" },
    { type: "endurance", durationMin: 90 },
  ],
};

describe("defaultTrainingSchedule", () => {
  it("is an enabled, modest week with sessions and rest days that reads back as itself", () => {
    const week = defaultTrainingSchedule();
    expect(week.enabled).toBe(true);
    expect(week.cycling).toBe("modest");
    expect(week.days).toHaveLength(7);
    const sessions = week.days.filter((d) => d.type !== "rest").length;
    expect(sessions).toBeGreaterThanOrEqual(3);
    expect(sessions).toBeLessThanOrEqual(5);
    expect(normalizeTrainingSchedule(week)).toEqual(week);
  });

  it("returns a fresh object every time", () => {
    const a = defaultTrainingSchedule();
    a.days[1].type = "rest";
    expect(defaultTrainingSchedule().days[1].type).not.toBe("rest");
  });
});

describe("withTrainingEnabled", () => {
  it("seeds the default week when there is no usable template", () => {
    for (const raw of [undefined, null, "x", { days: [] }]) {
      expect(withTrainingEnabled(raw, true)).toEqual(defaultTrainingSchedule());
    }
  });

  it("turning off keeps the template, so turning on again restores it", () => {
    const on = withTrainingDay(defaultTrainingSchedule(), 2, {
      type: "hiit",
      intensity: "hard",
    });
    const off = withTrainingEnabled(on, false);
    expect(off).toEqual({ ...on, enabled: false });
    expect(withTrainingEnabled(off, true)).toEqual(on);
  });

  it("keeps everything a newer client wrote, without mutating it", () => {
    const before = structuredClone(FROM_NEWER_CLIENT);
    const on = withTrainingEnabled(FROM_NEWER_CLIENT, true);
    expect(on).toEqual({ ...FROM_NEWER_CLIENT, enabled: true });
    expect(FROM_NEWER_CLIENT).toEqual(before);
  });
});

describe("withTrainingDay", () => {
  it("replaces only that weekday and drops the fields the edit cleared", () => {
    const next = withTrainingDay(FROM_NEWER_CLIENT, 1, { type: "rest" });
    expect(next.days[1]).toEqual({ type: "rest" });
    // Every other day is exactly what was stored — the unknown "yoga" too.
    for (const i of [0, 2, 3, 4, 5, 6]) {
      expect(next.days[i]).toEqual(FROM_NEWER_CLIENT.days[i]);
    }
    expect(next).toMatchObject({
      enabled: false,
      cycling: "aggressive",
      futureFlag: { keep: true },
    });
  });

  it("keeps unknown keys on the edited day itself", () => {
    const next = withTrainingDay(FROM_NEWER_CLIENT, 3, {
      type: "lower",
      intensity: "hard",
      time: "07:30",
      durationMin: 45,
    });
    expect(next.days[3]).toEqual({
      type: "lower",
      intensity: "hard",
      time: "07:30",
      durationMin: 45,
      note: "squats",
    });
  });

  it("edits the seeded week when there is no template yet", () => {
    const next = withTrainingDay(undefined, 0, {
      type: "sport",
      intensity: "light",
    });
    expect(next.days[0]).toEqual({ type: "sport", intensity: "light" });
    expect(next.days.slice(1)).toEqual(defaultTrainingSchedule().days.slice(1));
  });
});

describe("withTrainingCycling", () => {
  it("sets the preset and keeps the rest", () => {
    const next = withTrainingCycling(FROM_NEWER_CLIENT, "pronounced");
    expect(next).toEqual({ ...FROM_NEWER_CLIENT, cycling: "pronounced" });
  });
});

describe("withProteinSetting", () => {
  it("writes the setting clamped into the basis' safe range", () => {
    expect(
      withProteinSetting(undefined, { basis: "leanMass", gPerKg: 3.4 }),
    ).toEqual({ basis: "leanMass", gPerKg: 3.1 });
    expect(
      withProteinSetting(undefined, { basis: "bodyweight", gPerKg: 0.8 }),
    ).toEqual({ basis: "bodyweight", gPerKg: 1.2 });
    const set = withProteinSetting(null, { basis: "bodyweight", gPerKg: 2.2 });
    expect(normalizeProteinSetting(set)).toEqual(set);
  });

  it("keeps unknown keys a newer client stored", () => {
    expect(
      withProteinSetting(
        { basis: "leanMass", gPerKg: 2.6, perMeal: true },
        { basis: "bodyweight", gPerKg: 2.0 },
      ),
    ).toEqual({ basis: "bodyweight", gPerKg: 2.0, perMeal: true });
  });

  it("rounds to the 0.1 g/kg the stepper shows", () => {
    expect(
      withProteinSetting(undefined, { basis: "bodyweight", gPerKg: 2.1000004 }),
    ).toEqual({ basis: "bodyweight", gPerKg: 2.1 });
  });
});
