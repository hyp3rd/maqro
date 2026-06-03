import type { FoodItem } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import type { FastStatus } from "@/lib/fasting";
import { describe, expect, it } from "vitest";
import {
  FASTING_PHASES,
  phaseAtHours,
  phaseBreakdownMinutes,
  streakPhaseMinutes,
} from "./fasting-phases";

const MIN = 60_000;

function food(loggedAt: number): FoodItem {
  return {
    id: loggedAt,
    name: "x",
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 100,
    portionSize: 100,
    loggedAt,
  };
}

/** A day whose eating window is `windowMin` long, starting at local noon. */
function dayLog(date: string, windowMin: number): DailyLog {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(y, m - 1, d, 12, 0).getTime();
  return {
    date,
    meals: [
      {
        id: 1,
        name: "Meal",
        foods: [food(base), food(base + windowMin * MIN)],
      },
    ],
    updatedAt: 0,
  };
}

function fastStatus(over: Partial<FastStatus>): FastStatus {
  return {
    phase: "fasting",
    fastStartedAt: 0,
    fastEndsAt: 0,
    remainingMin: 0,
    elapsedMin: 0,
    progress: 0,
    ...over,
  };
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((s, n) => s + n, 0);
}

describe("phaseAtHours", () => {
  it("maps hours to the containing band (start-inclusive, end-exclusive)", () => {
    expect(phaseAtHours(0).key).toBe("fed");
    expect(phaseAtHours(3.9).key).toBe("fed");
    expect(phaseAtHours(4).key).toBe("settling");
    expect(phaseAtHours(11.9).key).toBe("glycogen");
    expect(phaseAtHours(12).key).toBe("fatBurning");
    expect(phaseAtHours(16).key).toBe("ketosis");
    expect(phaseAtHours(24).key).toBe("autophagy");
    expect(phaseAtHours(100).key).toBe("autophagy");
  });

  it("clamps negatives to the first phase", () => {
    expect(phaseAtHours(-5).key).toBe("fed");
  });
});

describe("phaseBreakdownMinutes", () => {
  it("splits a 16h fast across the first four bands and sums to the total", () => {
    const b = phaseBreakdownMinutes(16 * 60);
    expect(b.fed).toBe(240);
    expect(b.settling).toBe(240);
    expect(b.glycogen).toBe(240);
    expect(b.fatBurning).toBe(240);
    expect(b.ketosis).toBe(0);
    expect(b.autophagy).toBe(0);
    expect(sum(b)).toBe(960);
  });

  it("reaches ketosis + autophagy for a 30h fast and still sums to total", () => {
    const b = phaseBreakdownMinutes(30 * 60);
    expect(b.ketosis).toBe(8 * 60); // 16h→24h band fully covered
    expect(b.autophagy).toBe(6 * 60); // 24h→30h
    expect(sum(b)).toBe(30 * 60);
  });

  it("is all zeros for a zero / negative fast", () => {
    expect(sum(phaseBreakdownMinutes(0))).toBe(0);
    expect(sum(phaseBreakdownMinutes(-100))).toBe(0);
  });
});

describe("streakPhaseMinutes", () => {
  it("sums each streak day's fast (24h − window) plus today's live elapsed", () => {
    const logs = [
      dayLog("2026-06-01", 7 * 60),
      dayLog("2026-06-02", 7 * 60),
      dayLog("2026-06-03", 7 * 60), // today
    ];
    const totals = streakPhaseMinutes({
      logs,
      today: "2026-06-03",
      eatingHrs: 8,
      status: fastStatus({ phase: "fasting", elapsedMin: 13 * 60 }),
    });
    // Completed days fast 24−7=17h (1020m); today uses the live 13h (780m).
    // fatBurning: 60 + 60 + 60 = 180? No — 17h covers fatBurning fully (240)
    // for the two completed days, and the 13h day covers 60 of it.
    expect(totals.fatBurning).toBe(240 + 240 + 60);
    expect(totals.ketosis).toBe(60 + 60 + 0); // 17h spills 60m into ketosis
    expect(sum(totals)).toBe(1020 + 1020 + 780);
  });

  it("is all zeros when there is no streak", () => {
    const totals = streakPhaseMinutes({
      logs: [],
      today: "2026-06-03",
      eatingHrs: 8,
      status: fastStatus({ phase: "none" }),
    });
    expect(sum(totals)).toBe(0);
  });

  it("covers every phase key", () => {
    const totals = streakPhaseMinutes({
      logs: [dayLog("2026-06-03", 7 * 60)],
      today: "2026-06-03",
      eatingHrs: 8,
      status: fastStatus({ phase: "none" }),
    });
    // status "none" → today falls back to 24−window = 17h.
    for (const phase of FASTING_PHASES) {
      expect(totals[phase.key]).toBeGreaterThanOrEqual(0);
    }
  });
});
