import type { MealSchedule } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  formatDaysOfWeek,
  formatScheduleRange,
  schedulesForDay,
  scheduleTargetsSlot,
} from "./meal-schedule";

function sched(partial: Partial<MealSchedule>): MealSchedule {
  return {
    id: "s1",
    recipeId: "r1",
    recipeName: "Overnight oats",
    mealNames: ["breakfast"],
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    daysOfWeek: [1, 2, 3, 4, 5],
    scale: 1,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("schedulesForDay", () => {
  // 2026-06-08 is a Monday; 2026-06-13 is a Saturday.
  it("matches a date in range on an allowed weekday", () => {
    const s = sched({});
    expect(schedulesForDay([s], "2026-06-08")).toEqual([s]);
  });

  it("excludes a date before the start", () => {
    expect(schedulesForDay([sched({})], "2026-05-31")).toEqual([]);
  });

  it("excludes a date after the end", () => {
    expect(schedulesForDay([sched({})], "2026-07-01")).toEqual([]);
  });

  it("excludes an out-of-set weekday even when in range", () => {
    expect(schedulesForDay([sched({})], "2026-06-13")).toEqual([]); // Saturday
  });

  it("includes single-day start === end boundaries", () => {
    const s = sched({ startDate: "2026-06-08", endDate: "2026-06-08" });
    expect(schedulesForDay([s], "2026-06-08")).toEqual([s]);
  });
});

describe("scheduleTargetsSlot", () => {
  it("matches slot names case-insensitively and trimmed", () => {
    const s = sched({ mealNames: ["breakfast", "lunch"] });
    expect(scheduleTargetsSlot(s, "Breakfast")).toBe(true);
    expect(scheduleTargetsSlot(s, " LUNCH ")).toBe(true);
    expect(scheduleTargetsSlot(s, "Dinner")).toBe(false);
  });
});

describe("formatDaysOfWeek", () => {
  it("labels common weekday sets", () => {
    expect(formatDaysOfWeek([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(formatDaysOfWeek([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(formatDaysOfWeek([0, 6])).toBe("Weekends");
    expect(formatDaysOfWeek([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(formatDaysOfWeek([])).toBe("No days");
  });
});

describe("formatScheduleRange", () => {
  it("joins both endpoints with an en-dash (locale-robust)", () => {
    const out = formatScheduleRange("2026-06-07", "2026-07-05");
    expect(out.split(" – ")).toHaveLength(2);
    expect(out.split(" – ").every((part) => part.length > 0)).toBe(true);
  });
});
