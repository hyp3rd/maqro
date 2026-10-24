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
  const hook = await import("./use-week-intake");
  return { ...db, ...hook };
}

const meals = (kcal: number[]): Meal[] => [
  {
    id: 1,
    name: "Breakfast",
    foods: kcal.map((calories, i) => ({
      id: i + 1,
      name: "food",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories,
      portionSize: 100,
    })),
  },
];

describe("useWeekIntake", () => {
  it("reads only that week's logs as kcal per day", async () => {
    const { saveDailyLog, useWeekIntake } = await fresh();
    await saveDailyLog("2026-10-18", meals([999])); // the Sunday before
    await saveDailyLog("2026-10-19", meals([1200, 1080]));
    await saveDailyLog("2026-10-21", meals([1240]));
    await saveDailyLog("2026-10-26", meals([777])); // the Monday after

    const { result } = renderHook(() => useWeekIntake("2026-10-19"));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect([...result.current]).toEqual([
      ["2026-10-19", 2280],
      ["2026-10-21", 1240],
    ]);
  });

  it("refreshes when a day log is saved (the data-bus)", async () => {
    const { saveDailyLog, useWeekIntake } = await fresh();
    const { result } = renderHook(() => useWeekIntake("2026-10-19"));
    await waitFor(() => expect(result.current.size).toBe(0));

    await act(async () => {
      await saveDailyLog("2026-10-20", meals([2060]));
    });
    await waitFor(() => expect(result.current.get("2026-10-20")).toBe(2060));
  });

  it("never returns the previous week's read for a new week", async () => {
    const { saveDailyLog, useWeekIntake } = await fresh();
    await saveDailyLog("2026-10-21", meals([1240]));
    await saveDailyLog("2026-10-28", meals([1900]));
    const { result, rerender } = renderHook(
      ({ weekStart }) => useWeekIntake(weekStart),
      { initialProps: { weekStart: "2026-10-19" } },
    );
    await waitFor(() => expect(result.current.get("2026-10-21")).toBe(1240));

    // The new week's read is still in flight: nothing, not last week.
    rerender({ weekStart: "2026-10-26" });
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.get("2026-10-28")).toBe(1900));
    expect(result.current.has("2026-10-21")).toBe(false);
  });

  it("is empty without a week", async () => {
    const { useWeekIntake } = await fresh();
    const { result } = renderHook(() => useWeekIntake(null));
    expect(result.current.size).toBe(0);
  });
});
