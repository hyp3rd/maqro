import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  buildFastSessionInput,
  computeFastStatus,
  currentStreakDates,
  eatingHours,
  eatingWindowForDay,
  fastingStreak,
  formatDuration,
  lateCaloriePct,
  MIN_FAST_RECORD_MIN,
  protocolHours,
} from "./fasting";

const HOUR = 3_600_000;
const MIN = 60_000;

function food(loggedAt: number | undefined, calories = 100): FoodItem {
  return {
    id: loggedAt ?? Math.round(calories),
    name: "x",
    protein: 0,
    carbs: 0,
    fat: 0,
    calories,
    portionSize: 100,
    loggedAt,
  };
}

function meal(foods: FoodItem[]): Meal {
  return { id: 1, name: "Meal", foods };
}

function log(date: string, foods: FoodItem[]): DailyLog {
  return { date, meals: [meal(foods)], updatedAt: 0 };
}

describe("protocolHours / eatingHours", () => {
  it("maps each protocol to its fasting hours", () => {
    expect(protocolHours({ enabled: true, protocol: "16:8" })).toBe(16);
    expect(protocolHours({ enabled: true, protocol: "18:6" })).toBe(18);
    expect(protocolHours({ enabled: true, protocol: "20:4" })).toBe(20);
  });

  it("reads + clamps custom hours, defaults when absent", () => {
    expect(
      protocolHours({
        enabled: true,
        protocol: "custom",
        customFastingHours: 14,
      }),
    ).toBe(14);
    expect(
      protocolHours({
        enabled: true,
        protocol: "custom",
        customFastingHours: 99,
      }),
    ).toBe(23);
    expect(protocolHours({ enabled: true, protocol: "custom" })).toBe(16);
    expect(protocolHours(undefined)).toBe(16);
  });

  it("eatingHours is the complement", () => {
    expect(eatingHours({ enabled: true, protocol: "16:8" })).toBe(8);
    expect(eatingHours({ enabled: true, protocol: "20:4" })).toBe(4);
  });
});

describe("formatDuration", () => {
  it("humanizes minutes", () => {
    expect(formatDuration(200)).toBe("3h 20m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });
});

describe("eatingWindowForDay", () => {
  it("spans the first to last timed food", () => {
    const base = new Date(2026, 5, 3, 12, 0).getTime();
    const w = eatingWindowForDay([
      meal([food(base), food(base + 90 * MIN), food(undefined)]),
    ]);
    expect(w).not.toBeNull();
    expect(w!.firstAt).toBe(base);
    expect(w!.lastAt).toBe(base + 90 * MIN);
    expect(w!.lengthMin).toBe(90);
  });

  it("ignores foods without loggedAt; null when none are timed", () => {
    expect(
      eatingWindowForDay([meal([food(undefined), food(undefined)])]),
    ).toBeNull();
  });

  it("a past-midnight food extends the window (counts to its own moment)", () => {
    const dinner = new Date(2026, 5, 3, 23, 0).getTime();
    const snack = new Date(2026, 5, 4, 0, 30).getTime();
    const w = eatingWindowForDay([meal([food(dinner), food(snack)])]);
    expect(w!.lengthMin).toBe(90);
  });
});

describe("computeFastStatus", () => {
  const now = 1_000_000_000_000;

  it("is `none` when no fast is running", () => {
    const s = computeFastStatus({ fastStartedAt: null, fastingHours: 16, now });
    expect(s.phase).toBe("none");
    expect(s.fastEndsAt).toBeNull();
  });

  it("counts down from the manual start time", () => {
    const s = computeFastStatus({
      fastStartedAt: now - 2 * HOUR,
      fastingHours: 16,
      now,
    });
    expect(s.phase).toBe("fasting");
    expect(s.fastEndsAt).toBe(now - 2 * HOUR + 16 * HOUR);
    expect(s.remainingMin).toBe(14 * 60);
    expect(s.elapsedMin).toBe(2 * 60);
    expect(s.progress).toBeCloseTo(2 / 16, 5);
  });

  it("flips to eating once the target elapses", () => {
    const s = computeFastStatus({
      fastStartedAt: now - 17 * HOUR,
      fastingHours: 16,
      now,
    });
    expect(s.phase).toBe("eating");
    expect(s.progress).toBe(1);
    expect(s.elapsedMin).toBe(60); // window opened an hour ago
  });

  it("reflects an edited start time", () => {
    const s = computeFastStatus({
      fastStartedAt: now - 8 * HOUR, // user edited the start to 8h ago
      fastingHours: 16,
      now,
    });
    expect(s.elapsedMin).toBe(8 * 60);
    expect(s.remainingMin).toBe(8 * 60);
  });
});

describe("lateCaloriePct", () => {
  it("counts calories logged at/after the cutoff hour (local)", () => {
    const noon = new Date(2026, 5, 3, 12, 0).getTime();
    const nine = new Date(2026, 5, 3, 21, 0).getTime();
    const pct = lateCaloriePct(
      [meal([food(noon, 300), food(nine, 100), food(undefined, 999)])],
      20,
    );
    // 100 of 400 timed kcal are late → 25%. The untimed 999 is ignored.
    expect(pct).toBe(25);
  });

  it("is 0 when nothing is timed", () => {
    expect(lateCaloriePct([meal([food(undefined, 500)])], 20)).toBe(0);
  });
});

describe("fastingStreak", () => {
  // Build a day whose eating window is `lengthMin` long.
  function dayLog(date: string, lengthMin: number): DailyLog {
    const base = new Date(2026, 5, 3, 12, 0).getTime();
    return log(date, [food(base), food(base + lengthMin * MIN)]);
  }

  it("counts consecutive on-protocol days anchored at today", () => {
    const logs = [
      dayLog("2026-06-01", 7 * 60),
      dayLog("2026-06-02", 6 * 60),
      dayLog("2026-06-03", 8 * 60),
    ];
    const s = fastingStreak(logs, "2026-06-03", 8, 30);
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it("breaks the run on an over-window day", () => {
    const logs = [
      dayLog("2026-06-01", 7 * 60),
      dayLog("2026-06-02", 11 * 60), // over 8h + 30m grace → off protocol
      dayLog("2026-06-03", 7 * 60),
    ];
    const s = fastingStreak(logs, "2026-06-03", 8, 30);
    expect(s.current).toBe(1); // only today
    expect(s.longest).toBe(1);
  });

  it("allows the yesterday anchor (grace before a streak breaks)", () => {
    const logs = [dayLog("2026-06-01", 7 * 60), dayLog("2026-06-02", 7 * 60)];
    const s = fastingStreak(logs, "2026-06-03", 8, 30);
    expect(s.current).toBe(2); // anchored at yesterday
  });

  it("is zero with no timed days", () => {
    expect(fastingStreak([], "2026-06-03", 8).current).toBe(0);
  });
});

describe("currentStreakDates", () => {
  function dayLog(date: string, lengthMin: number): DailyLog {
    const base = new Date(2026, 5, 3, 12, 0).getTime();
    return log(date, [food(base), food(base + lengthMin * MIN)]);
  }

  it("returns the consecutive on-protocol run, oldest first", () => {
    const logs = [
      dayLog("2026-06-01", 7 * 60),
      dayLog("2026-06-02", 7 * 60),
      dayLog("2026-06-03", 7 * 60),
    ];
    expect(currentStreakDates(logs, "2026-06-03", 8, 30)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("stops at a break and only returns the run touching today/yesterday", () => {
    const logs = [
      dayLog("2026-05-30", 7 * 60),
      dayLog("2026-05-31", 11 * 60), // off-protocol → breaks the run
      dayLog("2026-06-02", 7 * 60),
      dayLog("2026-06-03", 7 * 60),
    ];
    expect(currentStreakDates(logs, "2026-06-03", 8, 30)).toEqual([
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("is empty when the streak is broken", () => {
    const logs = [dayLog("2026-05-30", 7 * 60)];
    expect(currentStreakDates(logs, "2026-06-03", 8, 30)).toEqual([]);
  });
});

describe("buildFastSessionInput", () => {
  const HOUR = 3_600_000;
  const START = 1_700_000_000_000;

  it("captures a running fast's span, protocol and target", () => {
    const fasting = {
      enabled: true,
      protocol: "16:8" as const,
      fastStartedAt: START,
    };
    expect(buildFastSessionInput(fasting, START + 16 * HOUR)).toEqual({
      startedAt: START,
      endedAt: START + 16 * HOUR,
      protocol: "16:8",
      targetHours: 16,
    });
  });

  it("pins the custom target (clamped) for a custom protocol", () => {
    const result = buildFastSessionInput(
      {
        enabled: true,
        protocol: "custom",
        customFastingHours: 18,
        fastStartedAt: START,
      },
      START + 18 * HOUR,
    );
    expect(result?.protocol).toBe("custom");
    expect(result?.targetHours).toBe(18);
  });

  it("returns null when no fast is running", () => {
    expect(buildFastSessionInput(undefined, START + HOUR)).toBeNull();
    expect(
      buildFastSessionInput(
        { enabled: true, protocol: "16:8", fastStartedAt: null },
        START + HOUR,
      ),
    ).toBeNull();
  });

  it("skips a sub-threshold span (an accidental start→stop)", () => {
    const fasting = {
      enabled: true,
      protocol: "16:8" as const,
      fastStartedAt: START,
    };
    // 15s rounds to 0 min — below the 1-minute floor. (Keep the constant in
    // the assertion's orbit so the test tracks the threshold's intent.)
    expect(MIN_FAST_RECORD_MIN).toBeGreaterThanOrEqual(1);
    expect(buildFastSessionInput(fasting, START + 15_000)).toBeNull();
  });

  it("skips a negative span (end before start)", () => {
    const fasting = {
      enabled: true,
      protocol: "20:4" as const,
      fastStartedAt: START,
    };
    expect(buildFastSessionInput(fasting, START - HOUR)).toBeNull();
  });
});
