import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  computeDailyTiming,
  computeDailyTimingInsights,
  computeWeeklyTimingInsights,
  formatCutoffHour,
} from "./timing-insights";

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

// Local-time constructor: `new Date(y, mIdx, d, h, m)` round-trips through the
// local getters `lateCaloriePct` / `minutesOfDay` use, so these are stable in
// any runner timezone (same pattern as fasting.test.ts).
const at = (h: number, m = 0) => new Date(2026, 5, 3, h, m).getTime();

describe("formatCutoffHour", () => {
  it("renders a 24h hour as a plain am/pm label", () => {
    expect(formatCutoffHour(20)).toBe("8pm");
    expect(formatCutoffHour(8)).toBe("8am");
    expect(formatCutoffHour(0)).toBe("12am");
    expect(formatCutoffHour(12)).toBe("12pm");
    expect(formatCutoffHour(23)).toBe("11pm");
    expect(formatCutoffHour(24)).toBe("12am"); // wraps
  });
});

describe("computeDailyTiming", () => {
  it("returns null when no food is timed", () => {
    expect(computeDailyTiming([meal([food(undefined), food(undefined)])])).toBe(
      null,
    );
  });

  it("derives the window span + late share", () => {
    const t = computeDailyTiming([
      meal([food(at(12), 100), food(at(18), 100)]),
    ]);
    expect(t).not.toBe(null);
    expect(t?.window.lengthMin).toBe(360); // 12:00 → 18:00
    expect(t?.latePct).toBe(0); // nothing after 8pm
  });
});

describe("computeDailyTimingInsights", () => {
  it("is empty when no food is timed", () => {
    expect(
      computeDailyTimingInsights({ meals: [meal([food(undefined)])] }),
    ).toEqual([]);
  });

  it("flags an on-protocol day as good", () => {
    const out = computeDailyTimingInsights({
      meals: [meal([food(at(12), 100), food(at(18), 100)])],
      eatingHoursTarget: 8, // 6h window ≤ 8h + grace
    });
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("good");
    expect(out[0].title).toMatch(/within your eating window/i);
  });

  it("warns when the window runs past the target and calories are late", () => {
    const out = computeDailyTimingInsights({
      meals: [meal([food(at(8), 100), food(at(21), 300)])],
      eatingHoursTarget: 8, // 13h window
    });
    // Both an over-window warn and a late-calorie warn; warnings first.
    expect(out.every((i) => i.tone === "warn")).toBe(true);
    expect(out.map((i) => i.title)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/over target/i),
        expect.stringMatching(/late in the day/i),
      ]),
    );
  });

  it("notes a little late eating as info (below the warn threshold)", () => {
    const out = computeDailyTimingInsights({
      meals: [meal([food(at(12), 900), food(at(21), 100)])],
      // no eatingHoursTarget → only the late-calorie read
    });
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("info"); // 10% late, < 25% warn floor
  });

  it("says nothing about lateness when nothing is late", () => {
    const out = computeDailyTimingInsights({
      meals: [meal([food(at(9), 100), food(at(15), 100)])],
    });
    expect(out).toEqual([]);
  });
});

describe("computeWeeklyTimingInsights", () => {
  it("returns nulls when no day has timed food", () => {
    const out = computeWeeklyTimingInsights([
      log("2026-06-01", [food(undefined)]),
      log("2026-06-02", [food(undefined)]),
    ]);
    expect(out).toEqual({
      daysWithTiming: 0,
      avgWindowMin: null,
      avgFirstMinOfDay: null,
      avgLastMinOfDay: null,
      avgLatePct: null,
      onProtocolDays: 0,
    });
  });

  it("averages only over days with timed food, and counts on-protocol days", () => {
    const out = computeWeeklyTimingInsights(
      [
        log("2026-06-01", [food(at(8), 100), food(at(12), 100)]), // 4h, 0% late
        log("2026-06-02", [food(at(10), 200), food(at(20), 200)]), // 10h, 50% late
        log("2026-06-03", [food(undefined)]), // untimed → ignored
      ],
      { eatingHoursTarget: 8 },
    );
    expect(out.daysWithTiming).toBe(2);
    expect(out.avgWindowMin).toBe(420); // (240 + 600) / 2
    expect(out.avgFirstMinOfDay).toBe(540); // (480 + 600) / 2
    expect(out.avgLastMinOfDay).toBe(960); // (720 + 1200) / 2
    expect(out.avgLatePct).toBe(25); // (0 + 50) / 2
    expect(out.onProtocolDays).toBe(1); // only the 4h day fits 8h + grace
  });
});
