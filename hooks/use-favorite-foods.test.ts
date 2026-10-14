/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Food } from "@maqro/core/types";
import { act, renderHook, waitFor } from "@testing-library/react";

const OATS: Food = {
  id: "oats",
  name: "Oats",
  protein: 13,
  carbs: 67,
  fat: 7,
  calories: 389,
};

async function fresh() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const status = await import("@/lib/sync-status");
  status.__resetSyncStatusForTests();
  const hook = await import("./use-favorite-foods");
  return { ...hook, status };
}

describe("useFavoriteFoods", () => {
  it("counts starring and un-starring a food as unsynced changes", async () => {
    const { useFavoriteFoods, status } = await fresh();
    const { result } = renderHook(() => useFavoriteFoods());

    await act(async () => {
      await result.current.toggle(OATS, 100);
    });
    await waitFor(() => expect(result.current.isFavorite("Oats")).toBe(true));
    // The sign-out guard and the "Save N" pill read this counter.
    expect(status.getSyncSnapshot().pending).toBe(1);

    await act(async () => {
      await result.current.toggle(OATS, 100);
    });
    await waitFor(() => expect(result.current.isFavorite("Oats")).toBe(false));
    expect(status.getSyncSnapshot().pending).toBe(2);
  });
});
