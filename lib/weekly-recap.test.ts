import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog, WeightEntry } from "@/lib/db";
import { describe, expect, it, vi } from "vitest";
import { targetsForDate } from "@maqro/core/targets";
import type { PersonalInfo } from "@maqro/core/types";
import { computeWeeklyRecap } from "./weekly-recap";

function food(
  name: string,
  macros: { p?: number; c?: number; f?: number; kcal?: number } = {},
): FoodItem {
  return {
    id: 1,
    name,
    protein: macros.p ?? 0,
    carbs: macros.c ?? 0,
    fat: macros.f ?? 0,
    calories: macros.kcal ?? 0,
    portionSize: 100,
  };
}

function meal(name: string, foods: FoodItem[]): Meal {
  return { id: 1, name, foods };
}

function dayLog(date: string, kcal: number): DailyLog {
  return {
    date,
    meals: [
      meal("Breakfast", [food("Day food", { p: 20, c: 30, f: 10, kcal })]),
    ],
    updatedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

function weighIn(date: string, kg: number): WeightEntry {
  return {
    date,
    kg,
    recordedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

const TODAY = "2026-05-18";

/** The same calorie target on every date. */
const flat = (kcal: number) => () => kcal;

describe("computeWeeklyRecap", () => {
  it("returns an empty window with zero counts when nothing is logged", () => {
    const r = computeWeeklyRecap([], [], flat(2000), TODAY);
    expect(r.windowStart).toBe("2026-05-12");
    expect(r.windowEnd).toBe("2026-05-18");
    expect(r.daysLogged).toBe(0);
    expect(r.avg).toEqual({ protein: 0, carbs: 0, fat: 0, calories: 0 });
    expect(r.weightDeltaKg).toBeNull();
    expect(r.adherenceDays).toBe(0);
  });

  it("counts only logged days in the average (skipped days don't drag the mean to zero)", () => {
    // 3 of 7 days logged. Average should be over THOSE 3, not 7.
    const logs = [
      dayLog("2026-05-15", 2000),
      dayLog("2026-05-17", 2200),
      dayLog("2026-05-18", 1800),
    ];
    const r = computeWeeklyRecap(logs, [], flat(2000), TODAY);
    expect(r.daysLogged).toBe(3);
    // (2000 + 2200 + 1800) / 3 = 2000
    expect(r.avg.calories).toBe(2000);
  });

  it("ignores logs outside the 7-day window", () => {
    const logs = [
      dayLog("2026-05-01", 9999), // outside
      dayLog("2026-05-11", 9999), // outside (window starts 05-12)
      dayLog("2026-05-12", 1800), // inside
      dayLog("2026-05-18", 1800), // inside
    ];
    const r = computeWeeklyRecap(logs, [], flat(2000), TODAY);
    expect(r.daysLogged).toBe(2);
    expect(r.avg.calories).toBe(1800);
  });

  it("ignores logs with zero calories (template-only days)", () => {
    const empty: DailyLog = {
      date: "2026-05-17",
      meals: [meal("Breakfast", [])],
      updatedAt: Date.now(),
      localUpdatedAt: new Date().toISOString(),
      serverUpdatedAt: null,
    };
    const r = computeWeeklyRecap(
      [empty, dayLog("2026-05-18", 1800)],
      [],
      flat(2000),
      TODAY,
    );
    expect(r.daysLogged).toBe(1);
  });

  it("counts adherence days within ±10% of target", () => {
    // 1800 vs 2000 target: diff 200 = 10% — borderline accepted.
    // 1700: diff 300 = 15% — rejected.
    // 2200: diff 200 = 10% — accepted.
    const logs = [
      dayLog("2026-05-15", 1800), // adherent
      dayLog("2026-05-16", 1700), // NOT adherent
      dayLog("2026-05-17", 2200), // adherent
    ];
    const r = computeWeeklyRecap(logs, [], flat(2000), TODAY);
    expect(r.adherenceDays).toBe(2);
  });

  it("does not flag adherence when target is 0 (avoid div-by-zero misclassification)", () => {
    const logs = [dayLog("2026-05-18", 1800)];
    const r = computeWeeklyRecap(logs, [], flat(0), TODAY);
    expect(r.adherenceDays).toBe(0);
  });

  it("reports weight delta as latest − earliest in window", () => {
    const r = computeWeeklyRecap(
      [],
      [
        weighIn("2026-05-12", 80.0),
        weighIn("2026-05-15", 79.5),
        weighIn("2026-05-18", 79.0), // -1.0 kg over the window
      ],
      flat(2000),
      TODAY,
    );
    expect(r.weightDeltaKg).toBeCloseTo(-1.0, 5);
  });

  it("returns null weightDelta when fewer than 2 weigh-ins are in the window", () => {
    const r = computeWeeklyRecap(
      [],
      [weighIn("2026-05-18", 80.0)],
      flat(2000),
      TODAY,
    );
    expect(r.weightDeltaKg).toBeNull();
  });

  it("scores each day against THAT day's own target", () => {
    // Each day hits its own target exactly; against one flat 2,200 target
    // only the 2,200 day would count (2,600 is +18%, 1,900 is −14%).
    const targets: Record<string, number> = {
      "2026-05-15": 2600,
      "2026-05-16": 1900,
      "2026-05-17": 2200,
    };
    const targetFor = vi.fn((date: string) => targets[date] ?? 0);
    const logs = [
      dayLog("2026-05-11", 9999), // outside the window: never resolved
      dayLog("2026-05-15", 2600),
      dayLog("2026-05-16", 1900),
      dayLog("2026-05-17", 2200),
    ];
    expect(computeWeeklyRecap(logs, [], targetFor, TODAY).adherenceDays).toBe(
      3,
    );
    expect(computeWeeklyRecap(logs, [], flat(2200), TODAY).adherenceDays).toBe(
      1,
    );
    expect(targetFor.mock.calls.map(([d]) => d)).toEqual([
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
    ]);
  });

  it("a day whose own target is 0 isn't scored", () => {
    const logs = [dayLog("2026-05-16", 1900), dayLog("2026-05-17", 2000)];
    const targetFor = (date: string) => (date === "2026-05-16" ? 0 : 2000);
    const r = computeWeeklyRecap(logs, [], targetFor, TODAY);
    expect(r.daysLogged).toBe(2);
    expect(r.adherenceDays).toBe(1);
  });

  it("a training week eaten to plan is on target every day", () => {
    // The mockup: 80 kg male cutting to a 2,200 kcal mean, with Mon upper,
    // Wed lower hard, Fri full body, Sat long run and rest days between.
    const profile: PersonalInfo = {
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
      weeklyRateKg: 0.4,
      manualTdee: 2640,
      units: "metric",
      training: {
        enabled: true,
        cycling: "modest",
        days: [
          { type: "rest" },
          { type: "upper", intensity: "moderate" },
          { type: "rest" },
          { type: "lower", intensity: "hard" },
          { type: "rest" },
          { type: "fullBody", intensity: "moderate" },
          { type: "endurance", durationMin: 90 },
        ],
      },
    };
    const ctx = { phasesEnabled: false };
    const targetFor = (date: string) =>
      targetsForDate(profile, date, ctx).targetCalories;
    const week = [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ];
    const logs = week.map((date) => dayLog(date, targetFor(date)));
    const r = computeWeeklyRecap(logs, [], targetFor, "2026-10-25");
    expect(r.daysLogged).toBe(7);
    expect(r.adherenceDays).toBe(7);
    // The same eating scored against the flat weekly mean misses the two
    // 2,450 days (the heavy Wednesday and the long-run Saturday, which
    // counts as heavy): planned cycling would read as "off plan".
    expect(
      computeWeeklyRecap(logs, [], flat(2200), "2026-10-25").adherenceDays,
    ).toBe(5);
  });
});
