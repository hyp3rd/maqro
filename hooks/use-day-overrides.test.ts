/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const DATE = "2026-10-22";

async function fresh() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const status = await import("@/lib/sync-status");
  status.__resetSyncStatusForTests();
  const db = await import("@/lib/db");
  const hook = await import("./use-day-overrides");
  return { ...hook, db, status };
}

describe("useDayOverrides", () => {
  it("loads the stored overrides", async () => {
    const { useDayOverrides, db } = await fresh();
    await db.saveDayOverride(DATE, { type: "rest" });

    const { result } = renderHook(() => useDayOverrides());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.overrides).toMatchObject([
      { date: DATE, day: { type: "rest" } },
    ]);
  });

  it("changing a day's session is stored, shown and counted as unsynced", async () => {
    const { useDayOverrides, db, status } = await fresh();
    const { result } = renderHook(() => useDayOverrides());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setOverride(DATE, { type: "lower" });
    });

    expect((await db.getDayOverride(DATE))?.day).toEqual({ type: "lower" });
    await waitFor(() =>
      expect(result.current.overrides.map((o) => o.date)).toEqual([DATE]),
    );
    expect(status.getSyncSnapshot().pending).toBe(1);
  });

  it("back to plan removes the override, leaves a tombstone, counts it", async () => {
    const { useDayOverrides, db, status } = await fresh();
    await db.saveDayOverride(DATE, { type: "rest" });
    const { result } = renderHook(() => useDayOverrides());
    await waitFor(() => expect(result.current.overrides).toHaveLength(1));

    await act(async () => {
      await result.current.clearOverride(DATE);
    });

    await waitFor(() => expect(result.current.overrides).toEqual([]));
    expect(
      (await db.listDeletions()).map((t) => [t.storeName, t.rowKey]),
    ).toEqual([["trainingDayOverrides", DATE]]);
    expect(status.getSyncSnapshot().pending).toBe(1);
  });

  it("a write that fails is reported to the storage banner and not claimed as saved", async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    const report = vi.fn();
    vi.doMock("@/lib/storage-status", () => ({
      reportStorageError: report,
      reportStorageOk: vi.fn(),
    }));
    vi.doMock("@/lib/db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/db")>()),
      saveDayOverride: vi
        .fn()
        .mockRejectedValue(new Error("QuotaExceededError")),
    }));
    const status = await import("@/lib/sync-status");
    status.__resetSyncStatusForTests();
    const { useDayOverrides } = await import("./use-day-overrides");
    const { result } = renderHook(() => useDayOverrides());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.setOverride(DATE, { type: "rest" });
    });

    expect(saved).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(status.getSyncSnapshot().pending).toBe(0);
    vi.doUnmock("@/lib/db");
    vi.doUnmock("@/lib/storage-status");
  });
});
