/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const DATE = "2026-05-13";

async function fresh() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const status = await import("@/lib/sync-status");
  status.__resetSyncStatusForTests();
  const hook = await import("./use-water-intake");
  return { ...hook, status };
}

describe("useWaterIntake", () => {
  it("counts a logged glass as an unsynced change", async () => {
    const { useWaterIntake, status } = await fresh();
    const { result } = renderHook(() => useWaterIntake(DATE));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.addWater(250);
    });

    // The sign-out guard and the "Save N" pill read this counter; a write it
    // can't see would be wiped on sign-out without being counted.
    expect(status.getSyncSnapshot().pending).toBe(1);
  });

  it("counts a corrected total as an unsynced change", async () => {
    const { useWaterIntake, status } = await fresh();
    const { result } = renderHook(() => useWaterIntake(DATE));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setTotal(1500);
    });

    expect(status.getSyncSnapshot().pending).toBe(1);
  });
});
