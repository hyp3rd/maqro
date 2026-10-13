/**
 * @vitest-environment jsdom
 */
import {
  __resetSyncStatusForTests,
  bumpPending,
  setSyncConflict,
  setSynced,
  setSyncing,
} from "@/lib/sync-status";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { SyncModeController } from "./SyncModeController";

const mockTriggerSync = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sync", () => ({ triggerSync: mockTriggerSync }));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => ({}) }));
vi.mock("@/lib/sync-mode", () => ({
  useSyncMode: () => ({ mode: "remote-only", intervalMinutes: 5 }),
}));

const REMOTE_DEBOUNCE_MS = 2_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetSyncStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetSyncStatusForTests();
});

describe("SyncModeController — remote-only", () => {
  it("pushes shortly after a local write", () => {
    render(<SyncModeController />);

    act(() => bumpPending());
    act(() => vi.advanceTimersByTime(REMOTE_DEBOUNCE_MS));

    expect(mockTriggerSync).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire a sync that ended in a conflict until something new is written", () => {
    render(<SyncModeController />);

    // A write, its sync, and a conflict the user hasn't resolved yet: the
    // conflicted rows keep `pending` above zero.
    act(() => bumpPending());
    act(() => setSyncing());
    act(() => setSyncConflict(1));
    act(() => vi.advanceTimersByTime(REMOTE_DEBOUNCE_MS * 5));
    expect(mockTriggerSync).not.toHaveBeenCalled();

    // A genuinely new write still gets pushed.
    act(() => bumpPending());
    act(() => vi.advanceTimersByTime(REMOTE_DEBOUNCE_MS));
    expect(mockTriggerSync).toHaveBeenCalledTimes(1);
  });

  it("re-fires after a successful sync that raced a write", () => {
    render(<SyncModeController />);

    act(() => setSyncing());
    act(() => bumpPending()); // written while the sync was in flight
    act(() => setSynced());
    act(() => vi.advanceTimersByTime(REMOTE_DEBOUNCE_MS));

    expect(mockTriggerSync).toHaveBeenCalledTimes(1);
  });
});
