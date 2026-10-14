/**
 * @vitest-environment jsdom
 */
import { SyncIncompleteError } from "@/lib/sync";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { SyncManager } from "./SyncManager";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string },
  triggerSync: vi.fn(),
  registerCurrentDevice: vi.fn(),
  watchForForcedSignOut: vi.fn(),
  startRealtimeSubscription: vi.fn(),
  reportClientError: vi.fn(),
}));

vi.mock("@/lib/error-reporter", () => ({
  reportClientError: mocks.reportClientError,
}));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  triggerSync: mocks.triggerSync,
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: mocks.user, isLoaded: true }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => ({}) }));
vi.mock("@/lib/demo-data", () => ({
  clearDemoModeData: () => Promise.resolve(),
}));
vi.mock("@/lib/devices/registry", () => ({
  registerCurrentDevice: mocks.registerCurrentDevice,
}));
vi.mock("@/lib/devices/forced-signout", () => ({
  watchForForcedSignOut: mocks.watchForForcedSignOut,
}));
vi.mock("@/lib/sync/realtime", () => ({
  startRealtimeSubscription: mocks.startRealtimeSubscription,
}));

/** Let the sign-in promise chain settle: a macrotask boundary runs every
 *  queued microtask (the chain has no timers). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function expectLifecycleStarted(): void {
  expect(mocks.registerCurrentDevice).toHaveBeenCalledTimes(1);
  expect(mocks.watchForForcedSignOut).toHaveBeenCalledWith(
    expect.anything(),
    USER_ID,
  );
  expect(mocks.startRealtimeSubscription).toHaveBeenCalledWith(
    expect.anything(),
    USER_ID,
    expect.anything(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: USER_ID };
  mocks.registerCurrentDevice.mockResolvedValue(undefined);
  mocks.watchForForcedSignOut.mockReturnValue({ unsubscribe: vi.fn() });
  mocks.startRealtimeSubscription.mockReturnValue({ unsubscribe: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe("SyncManager — sign-in lifecycle", () => {
  it("starts realtime, the forced-sign-out watcher and device registration after a clean sync", async () => {
    mocks.triggerSync.mockResolvedValue({ conflicts: [] });

    render(<SyncManager />);
    await settle();

    expect(mocks.triggerSync).toHaveBeenCalledTimes(1);
    expectLifecycleStarted();
  });

  it("still starts them when the sync completed with some rows rejected", async () => {
    // One permanently rejected row (e.g. a CHECK violation) makes every run
    // end in SyncIncompleteError. That must not keep this device from
    // receiving peer changes or honouring a remote "disconnect".
    mocks.triggerSync.mockRejectedValue(
      new SyncIncompleteError([new Error("new row violates check")]),
    );

    const { rerender } = render(<SyncManager />);
    await settle();

    expectLifecycleStarted();

    // The completed run counts as this user's initial sync: a re-render
    // with a fresh user object does not start another one.
    mocks.user = { id: USER_ID };
    rerender(<SyncManager />);
    await settle();
    expect(mocks.triggerSync).toHaveBeenCalledTimes(1);
  });

  it("skips them and re-arms the initial sync when the sync could not complete", async () => {
    mocks.triggerSync.mockRejectedValue(new Error("unexpected"));

    const { rerender } = render(<SyncManager />);
    await settle();

    expect(mocks.registerCurrentDevice).not.toHaveBeenCalled();
    expect(mocks.watchForForcedSignOut).not.toHaveBeenCalled();
    expect(mocks.startRealtimeSubscription).not.toHaveBeenCalled();

    mocks.user = { id: USER_ID };
    rerender(<SyncManager />);
    await settle();
    expect(mocks.triggerSync).toHaveBeenCalledTimes(2);
  });

  it("reports a failed catch-up sync after a reconnect instead of swallowing it", async () => {
    mocks.triggerSync.mockResolvedValueOnce({ conflicts: [] });
    render(<SyncManager />);
    await settle();
    const opts = mocks.startRealtimeSubscription.mock.calls[0]?.[2] as {
      onReconnect: () => void;
    };
    const failure = new Error("offline again");
    mocks.triggerSync.mockRejectedValueOnce(failure);

    opts.onReconnect();
    await settle();

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ route: "sync" }),
    );
  });
});
