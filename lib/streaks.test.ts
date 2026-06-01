import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  computeStreak,
  nextMilestone,
  reachedMilestone,
  STREAK_MILESTONES,
} from "./streaks";

function food(name: string, calories = 100): FoodItem {
  return {
    id: 1,
    name,
    protein: 10,
    carbs: 10,
    fat: 5,
    calories,
    portionSize: 100,
  };
}

function meal(name: string, foods: FoodItem[] = []): Meal {
  return { id: 1, name, foods };
}

function dailyLog(date: string, hasFood = true): DailyLog {
  const foods = hasFood ? [food("Anything")] : [];
  return {
    date,
    meals: [meal("Breakfast", foods)],
    updatedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

describe("computeStreak", () => {
  it("returns zeros + null for an empty history", () => {
    expect(computeStreak([], "2026-05-18")).toEqual({
      current: 0,
      longest: 0,
      lastLoggedDate: null,
    });
  });

  it("ignores days that exist but have no logged foods", () => {
    // User opened the app, the default meal slots got persisted with
    // empty `foods` arrays for a week. None of those should count.
    const logs = [
      dailyLog("2026-05-12", false),
      dailyLog("2026-05-13", false),
      dailyLog("2026-05-14", false),
    ];
    expect(computeStreak(logs, "2026-05-18")).toEqual({
      current: 0,
      longest: 0,
      lastLoggedDate: null,
    });
  });

  it("counts a single logged day today as a streak of 1", () => {
    expect(computeStreak([dailyLog("2026-05-18", true)], "2026-05-18")).toEqual(
      { current: 1, longest: 1, lastLoggedDate: "2026-05-18" },
    );
  });

  it("computes a contiguous current streak ending today", () => {
    const logs = [
      dailyLog("2026-05-15"),
      dailyLog("2026-05-16"),
      dailyLog("2026-05-17"),
      dailyLog("2026-05-18"),
    ];
    expect(computeStreak(logs, "2026-05-18")).toEqual({
      current: 4,
      longest: 4,
      lastLoggedDate: "2026-05-18",
    });
  });

  it("grants the grace day: streak survives if yesterday was logged but today isn't", () => {
    const logs = [
      dailyLog("2026-05-16"),
      dailyLog("2026-05-17"),
      // 2026-05-18 not yet logged - user hasn't eaten yet today
    ];
    expect(computeStreak(logs, "2026-05-18").current).toBe(2);
  });

  it("breaks the streak once the gap exceeds the grace day", () => {
    const logs = [
      dailyLog("2026-05-15"),
      dailyLog("2026-05-16"),
      // Skipped 2026-05-17 AND 2026-05-18 - streak broken
    ];
    expect(computeStreak(logs, "2026-05-18").current).toBe(0);
  });

  it("preserves the all-time longest across a broken current streak", () => {
    const logs = [
      // Old 5-day run, then a long break
      dailyLog("2026-04-01"),
      dailyLog("2026-04-02"),
      dailyLog("2026-04-03"),
      dailyLog("2026-04-04"),
      dailyLog("2026-04-05"),
      // Single log today - current streak = 1, longest stays 5
      dailyLog("2026-05-18"),
    ];
    const result = computeStreak(logs, "2026-05-18");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(5);
    expect(result.lastLoggedDate).toBe("2026-05-18");
  });

  it("handles out-of-order input (logs not sorted by date)", () => {
    const logs = [
      dailyLog("2026-05-17"),
      dailyLog("2026-05-15"),
      dailyLog("2026-05-18"),
      dailyLog("2026-05-16"),
    ];
    expect(computeStreak(logs, "2026-05-18").current).toBe(4);
  });
});

describe("nextMilestone", () => {
  it("returns the first milestone for a fresh streak", () => {
    expect(nextMilestone(0)).toBe(STREAK_MILESTONES[0]);
    expect(nextMilestone(1)).toBe(STREAK_MILESTONES[0]);
  });

  it("returns the next strictly-greater milestone", () => {
    // Current is exactly on a milestone → next is the one after.
    expect(nextMilestone(7)).toBe(14);
    expect(nextMilestone(30)).toBe(60);
  });

  it("returns null once the user has crossed every milestone", () => {
    const last = STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
    if (last === undefined) return;
    expect(nextMilestone(last)).toBe(null);
    expect(nextMilestone(last + 100)).toBe(null);
  });
});

describe("reachedMilestone", () => {
  it("returns null below the first milestone", () => {
    expect(reachedMilestone(0)).toBe(null);
    expect(reachedMilestone(2)).toBe(null);
  });

  it("returns the highest milestone at or below current", () => {
    expect(reachedMilestone(3)).toBe(3);
    expect(reachedMilestone(6)).toBe(3);
    expect(reachedMilestone(7)).toBe(7);
    expect(reachedMilestone(29)).toBe(14);
    expect(reachedMilestone(30)).toBe(30);
  });

  it("returns the final milestone for any value above it", () => {
    const last = STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
    if (last === undefined) return;
    expect(reachedMilestone(last + 1000)).toBe(last);
  });
});
