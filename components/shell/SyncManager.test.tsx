/**
 * @vitest-environment jsdom
 */
import { MfaRequiredError } from "@/lib/auth/session-assurance";
import { SyncIncompleteError } from "@/lib/sync";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SyncManager } from "./SyncManager";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string },
  triggerSync: vi.fn(),
  assertDataApiAssurance: vi.fn(),
  requestMfaChallenge: vi.fn(),
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
  useUser: () => ({ user: mocks.user, isLoaded: true, isUnconfigured: false }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => ({}) }));
vi.mock("@/lib/demo-data", () => ({
  clearDemoModeData: () => Promise.resolve(),
}));
vi.mock("@/lib/auth/session-assurance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session-assurance")>()),
  assertDataApiAssurance: mocks.assertDataApiAssurance,
}));
vi.mock("@/lib/auth/mfa-challenge-bus", () => ({
  requestMfaChallenge: mocks.requestMfaChallenge,
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

function expectNoDataApiFollowUps(): void {
  expect(mocks.registerCurrentDevice).not.toHaveBeenCalled();
  expect(mocks.watchForForcedSignOut).not.toHaveBeenCalled();
  expect(mocks.startRealtimeSubscription).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: USER_ID };
  mocks.assertDataApiAssurance.mockResolvedValue(undefined);
  mocks.requestMfaChallenge.mockResolvedValue(undefined);
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

    expectNoDataApiFollowUps();

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

describe("SyncManager — second factor", () => {
  it("prompts for the second factor and starts nothing else when sync is refused", async () => {
    mocks.triggerSync.mockRejectedValue(new MfaRequiredError());
    render(<SyncManager />);
    await waitFor(() =>
      expect(mocks.requestMfaChallenge).toHaveBeenCalledOnce(),
    );
    expectNoDataApiFollowUps();
  });

  it("re-checks assurance when triggerSync skipped (a sync was already running)", async () => {
    mocks.triggerSync.mockResolvedValue(null);
    mocks.assertDataApiAssurance.mockRejectedValue(new MfaRequiredError());
    render(<SyncManager />);
    await waitFor(() =>
      expect(mocks.requestMfaChallenge).toHaveBeenCalledOnce(),
    );
    expectNoDataApiFollowUps();
  });

  it("re-checks assurance after a sync that completed with some rows rejected", async () => {
    // SyncIncompleteError still starts the lifecycle, but only through the
    // same second-factor gate as a clean run.
    mocks.triggerSync.mockRejectedValue(
      new SyncIncompleteError([new Error("new row violates check")]),
    );
    mocks.assertDataApiAssurance.mockRejectedValue(new MfaRequiredError());
    const { rerender } = render(<SyncManager />);
    await waitFor(() =>
      expect(mocks.requestMfaChallenge).toHaveBeenCalledOnce(),
    );
    expectNoDataApiFollowUps();

    // Not a completed sign-in chain: the next user emission retries it.
    mocks.user = { id: USER_ID };
    rerender(<SyncManager />);
    await settle();
    expect(mocks.triggerSync).toHaveBeenCalledTimes(2);
  });

  it("does not prompt for other sync failures", async () => {
    mocks.triggerSync.mockRejectedValue(new Error("network down"));
    render(<SyncManager />);
    await waitFor(() => expect(mocks.triggerSync).toHaveBeenCalled());
    await settle();
    expect(mocks.requestMfaChallenge).not.toHaveBeenCalled();
    expectNoDataApiFollowUps();
  });

  it("registers the device and subscribes once the session is cleared", async () => {
    mocks.triggerSync.mockResolvedValue({});
    render(<SyncManager />);
    await waitFor(() =>
      expect(mocks.startRealtimeSubscription).toHaveBeenCalledOnce(),
    );
    expect(mocks.assertDataApiAssurance).toHaveBeenCalledOnce();
    expect(mocks.registerCurrentDevice).toHaveBeenCalledOnce();
    expect(mocks.requestMfaChallenge).not.toHaveBeenCalled();
  });
});
