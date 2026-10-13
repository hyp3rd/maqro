/**
 * @vitest-environment jsdom
 */
import type { Meal } from "@/components/macro/types";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";

/** Controllable auth state. Defaults to signed-out (what `useUser` reports
 *  when Supabase isn't configured) so the original suites keep their
 *  guest-mode behaviour; the identity suites flip it per test. */
const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: auth.user, isLoaded: true, isUnconfigured: false }),
}));

function asUser(id: string): User {
  return { id } as User;
}

const DEFAULT_MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

async function freshHook() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  // Reset the storage-status pub-sub too so a failed test doesn't bleed.
  const status = await import("@/lib/storage-status");
  status.__resetStorageStatusForTests();
  return await import("./use-daily-log");
}

describe("useDailyLog", () => {
  beforeEach(async () => {
    auth.user = null;
    await freshHook();
  });

  it("hydrates to empty for a date with no log", async () => {
    const { useDailyLog } = await freshHook();
    const { result } = renderHook(() =>
      useDailyLog("2026-05-13", DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.date).toBe("2026-05-13");
    expect(result.current.meals).toEqual(DEFAULT_MEALS);
  });

  it("persists across hook unmount/remount with the same date", async () => {
    const { useDailyLog } = await freshHook();
    // First mount: set meals.
    const first = renderHook(() => useDailyLog("2026-05-13", DEFAULT_MEALS));
    await waitFor(() => expect(first.result.current.isHydrated).toBe(true));
    act(() => {
      first.result.current.setMeals([
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
        ...DEFAULT_MEALS.slice(1),
      ]);
    });
    // Wait for the debounced write to flush.
    await new Promise((r) => setTimeout(r, 700));
    first.unmount();

    // Second mount: should hydrate from IDB.
    const second = renderHook(() => useDailyLog("2026-05-13", DEFAULT_MEALS));
    await waitFor(() => expect(second.result.current.isHydrated).toBe(true));
    expect(second.result.current.meals[0].foods).toHaveLength(1);
    expect(second.result.current.meals[0].foods[0].name).toBe("Oats");
  });

  it("switching date reloads the new day's log", async () => {
    const { useDailyLog } = await freshHook();
    // Seed yesterday.
    const yesterday = renderHook(() =>
      useDailyLog("2026-05-12", DEFAULT_MEALS),
    );
    await waitFor(() => expect(yesterday.result.current.isHydrated).toBe(true));
    act(() => {
      yesterday.result.current.setMeals([
        {
          id: 1,
          name: "Breakfast",
          foods: [
            {
              id: 1,
              name: "Eggs",
              protein: 13,
              carbs: 1,
              fat: 11,
              calories: 155,
              portionSize: 100,
            },
          ],
        },
        ...DEFAULT_MEALS.slice(1),
      ]);
    });
    await new Promise((r) => setTimeout(r, 700));
    yesterday.unmount();

    // Mount with today's date — should be empty (no log for today).
    const today = renderHook(() => useDailyLog("2026-05-13", DEFAULT_MEALS));
    await waitFor(() => expect(today.result.current.isHydrated).toBe(true));
    expect(today.result.current.meals[0].foods).toHaveLength(0);

    // Re-mount with yesterday's date — meals should reappear.
    today.unmount();
    const back = renderHook(() => useDailyLog("2026-05-12", DEFAULT_MEALS));
    await waitFor(() => expect(back.result.current.isHydrated).toBe(true));
    expect(back.result.current.meals[0].foods[0].name).toBe("Eggs");
  });

  it("skips writes while not hydrated", async () => {
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    const saveSpy = vi.spyOn(db, "saveDailyLog");
    renderHook(() => useDailyLog("2026-05-13", DEFAULT_MEALS));
    // Don't wait for hydration; nothing should have written by now
    // (the load hasn't even resolved).
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("does NOT auto-save synthetic defaults when nothing was loaded from IDB", async () => {
    // The regression this guards: a fresh session (incognito window /
    // freshly cleared IDB) would otherwise auto-save the empty
    // `defaultMeals` to IDB, and the initial sync push would upload
    // those empties — clobbering the user's real server-side meals.
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    const saveSpy = vi.spyOn(db, "saveDailyLog");

    const { result } = renderHook(() =>
      useDailyLog("2026-05-13", DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    // Wait past the 500 ms debounce window the save effect uses.
    await new Promise((r) => setTimeout(r, 600));

    expect(saveSpy).not.toHaveBeenCalled();
    expect(result.current.meals).toEqual(DEFAULT_MEALS);
  });

  it("auto-saves once the user actually edits", async () => {
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    const saveSpy = vi.spyOn(db, "saveDailyLog");

    const { result } = renderHook(() =>
      useDailyLog("2026-05-13", DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setMeals([
        {
          id: 1,
          name: "Breakfast",
          foods: [
            {
              id: 1,
              name: "Eggs",
              protein: 6,
              carbs: 0,
              fat: 5,
              calories: 70,
              portionSize: 50,
            },
          ],
        },
        ...DEFAULT_MEALS.slice(1),
      ]);
    });

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
  });
});

const DATE = "2026-05-13";

function dayWith(name: string): Meal[] {
  return [
    {
      id: 1,
      name: "Breakfast",
      foods: [
        {
          id: 1,
          name,
          protein: 13,
          carbs: 67,
          fat: 7,
          calories: 389,
          portionSize: 100,
        },
      ],
    },
    ...DEFAULT_MEALS.slice(1),
  ];
}

/** Lets any pending 500 ms debounced write fire (or proves none was queued). */
function pastDebounce() {
  return new Promise((r) => setTimeout(r, 700));
}

describe("useDailyLog - identity changes", () => {
  beforeEach(() => {
    auth.user = null;
  });

  it("does not re-persist the signed-out user's day into the wiped store", async () => {
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    auth.user = asUser("user-a");
    await db.saveDailyLog(DATE, dayWith("A's oats"));

    const { result, rerender } = renderHook(() =>
      useDailyLog(DATE, DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.meals[0]!.foods[0]!.name).toBe("A's oats");
    await pastDebounce();

    const saveSpy = vi.spyOn(db, "saveDailyLog");
    // signOutAndClearLocal: wipe first, then the auth change lands.
    await db.clearAllStores();
    auth.user = null;
    rerender();
    await pastDebounce();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(await db.getDailyLog(DATE)).toBeNull();
    // The guest UI no longer shows the previous account's meals.
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.meals).toEqual(DEFAULT_MEALS);
  });

  it("does not carry one account's day into the next on an account switch", async () => {
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    auth.user = asUser("user-a");
    await db.saveDailyLog(DATE, dayWith("A's oats"));

    const { result, rerender } = renderHook(() =>
      useDailyLog(DATE, DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await pastDebounce();

    const saveSpy = vi.spyOn(db, "saveDailyLog");
    await db.clearAllStores();
    auth.user = asUser("user-b");
    rerender();
    await pastDebounce();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(await db.getDailyLog(DATE)).toBeNull();
    await waitFor(() => expect(result.current.meals).toEqual(DEFAULT_MEALS));
  });

  it("an auth change alone (guest -> signed in) does not trigger a write", async () => {
    const { useDailyLog } = await freshHook();
    const db = await import("@/lib/db");
    await db.saveDailyLog(DATE, dayWith("Guest oats"));

    const { result, rerender } = renderHook(() =>
      useDailyLog(DATE, DEFAULT_MEALS),
    );
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await pastDebounce();

    const saveSpy = vi.spyOn(db, "saveDailyLog");
    auth.user = asUser("user-a");
    rerender();
    await pastDebounce();

    expect(saveSpy).not.toHaveBeenCalled();
    // Guest data is adopted by the signed-in user (it syncs up by design),
    // so the day stays hydrated with the same meals.
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.meals[0]!.foods[0]!.name).toBe("Guest oats");
  });
});
