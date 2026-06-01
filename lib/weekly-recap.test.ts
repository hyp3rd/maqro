import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog, WeightEntry } from "@/lib/db";
import { describe, expect, it } from "vitest";
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

describe("computeWeeklyRecap", () => {
  it("returns an empty window with zero counts when nothing is logged", () => {
    const r = computeWeeklyRecap([], [], 2000, TODAY);
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
    const r = computeWeeklyRecap(logs, [], 2000, TODAY);
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
    const r = computeWeeklyRecap(logs, [], 2000, TODAY);
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
      2000,
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
    const r = computeWeeklyRecap(logs, [], 2000, TODAY);
    expect(r.adherenceDays).toBe(2);
  });

  it("does not flag adherence when target is 0 (avoid div-by-zero misclassification)", () => {
    const logs = [dayLog("2026-05-18", 1800)];
    const r = computeWeeklyRecap(logs, [], 0, TODAY);
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
      2000,
      TODAY,
    );
    expect(r.weightDeltaKg).toBeCloseTo(-1.0, 5);
  });

  it("returns null weightDelta when fewer than 2 weigh-ins are in the window", () => {
    const r = computeWeeklyRecap(
      [],
      [weighIn("2026-05-18", 80.0)],
      2000,
      TODAY,
    );
    expect(r.weightDeltaKg).toBeNull();
  });
});
