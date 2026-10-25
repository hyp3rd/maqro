/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Meal } from "@maqro/core/types";
import { act, renderHook, waitFor } from "@testing-library/react";

async function fresh() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const db = await import("@/lib/db");
  const hook = await import("./use-usual-meal-minutes");
  return { ...db, ...hook };
}

const TODAY = "2026-10-25";

/** A Lunch whose one food was logged at `hh:mm` on `date`. */
function lunchAt(date: string, hh: number, mm = 0): Meal[] {
  const [y, m, d] = date.split("-").map(Number);
  return [
    {
      id: 2,
      name: "Lunch",
      foods: [
        {
          id: 1,
          name: "Soup",
          protein: 10,
          carbs: 20,
          fat: 5,
          calories: 165,
          portionSize: 300,
          loggedAt: new Date(y, m - 1, d, hh, mm).getTime(),
        },
      ],
    },
  ];
}

describe("useUsualMealMinutes", () => {
  it("the median over the days before today, today and older days left out", async () => {
    const { saveDailyLog, useUsualMealMinutes } = await fresh();
    await saveDailyLog("2026-09-20", lunchAt("2026-09-20", 6)); // 35 days back
    await saveDailyLog("2026-10-20", lunchAt("2026-10-20", 12));
    await saveDailyLog("2026-10-21", lunchAt("2026-10-21", 13));
    await saveDailyLog("2026-10-22", lunchAt("2026-10-22", 12, 30));
    await saveDailyLog(TODAY, lunchAt(TODAY, 17)); // today: not history

    const { result } = renderHook(() => useUsualMealMinutes(TODAY));
    await waitFor(() => expect(result.current[2]).toBe(12 * 60 + 30));
  });

  it("re-reads when a past day is saved (a pulled history counts)", async () => {
    const { saveDailyLog, useUsualMealMinutes } = await fresh();
    await saveDailyLog("2026-10-20", lunchAt("2026-10-20", 13));
    await saveDailyLog("2026-10-21", lunchAt("2026-10-21", 13));
    const { result } = renderHook(() => useUsualMealMinutes(TODAY));
    await waitFor(() => expect(result.current).toEqual({}));

    await act(async () => {
      await saveDailyLog("2026-10-22", lunchAt("2026-10-22", 13));
    });
    await waitFor(() => expect(result.current[2]).toBe(13 * 60));
  });

  it("nothing before the date is known", async () => {
    const { useUsualMealMinutes } = await fresh();
    const { result } = renderHook(() => useUsualMealMinutes(""));
    expect(result.current).toEqual({});
  });
});

describe("useUsualMealMinutes identity", () => {
  it("keeps the same object when a save changes no usual time", async () => {
    const { saveDailyLog, useUsualMealMinutes } = await fresh();
    for (const date of ["2026-10-20", "2026-10-21", "2026-10-22"]) {
      await saveDailyLog(date, lunchAt(date, 13));
    }
    const { result } = renderHook(() => useUsualMealMinutes(TODAY));
    await waitFor(() => expect(result.current[2]).toBe(13 * 60));
    const before = result.current;

    await act(async () => {
      await saveDailyLog(TODAY, lunchAt(TODAY, 18)); // today: not history
    });
    // Let the re-read land, then compare identity.
    await act(async () => {});
    expect(result.current).toBe(before);
  });
});
