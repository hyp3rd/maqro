/**
 * @vitest-environment jsdom
 */
import { clearAllStores, saveDailyLog, todayKey } from "@/lib/db";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@maqro/core/date";
import type { Meal } from "@maqro/core/types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StreakChip } from "./StreakChip";

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast }));

const MEALS: Meal[] = [
  {
    id: 1,
    name: "Breakfast",
    foods: [
      {
        id: 1,
        name: "Oats",
        protein: 13,
        carbs: 67,
        fat: 7,
        calories: 389,
        portionSize: 100,
      },
    ],
  },
];

/** Log a meal on each of the `days` days ending `daysAgo` days ago. */
async function logRun(days: number, daysAgo = 0) {
  const today = todayKey();
  for (let i = 0; i < days; i += 1) {
    await saveDailyLog(addDays(today, -(daysAgo + i)), MEALS);
  }
}

/** The chip's reading ("7d"), or null while it shows nothing. */
const chipText = () =>
  document.querySelector("[aria-live=polite]")?.textContent ?? null;

/** Wait for the chip to read a `days`-day streak. */
async function streakShown(days: number) {
  await waitFor(() => expect(chipText()).toBe(`${days}d`));
}

beforeEach(async () => {
  // The app keeps one IndexedDB connection: empty it between cases.
  await clearAllStores();
  window.localStorage.clear();
  toast.mockClear();
});
afterEach(() => cleanup());

describe("StreakChip milestone note", () => {
  it("doesn't toast a milestone already reached as Today first renders", async () => {
    await logRun(7);
    render(<StreakChip />);
    await streakShown(7);
    expect(toast).not.toHaveBeenCalled();
    // Recorded, so it never fires later in the session either.
    expect(window.localStorage.getItem("maqro:streak:last-celebrated")).toBe(
      "7",
    );
  });

  it("notes a milestone crossed by logging while the app is open", async () => {
    // Six days through yesterday; today's first meal makes seven.
    await logRun(6, 1);
    render(<StreakChip />);
    await streakShown(6);
    await act(async () => {
      await saveDailyLog(todayKey(), MEALS);
    });
    await streakShown(7);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]?.[0]).toBe("7-day logging streak");
  });

  it("doesn't toast a jump in the streak (a demo seed, a sync pull)", async () => {
    // Three days through yesterday, read while open.
    await logRun(3, 1);
    render(<StreakChip />);
    await streakShown(3);
    // Four earlier days arrive at once: 3 → 7, past the 7-day milestone.
    await act(async () => {
      await logRun(4, 4);
    });
    await streakShown(7);
    expect(toast).not.toHaveBeenCalled();
  });
});
