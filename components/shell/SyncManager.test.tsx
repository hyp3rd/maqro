/**
 * @vitest-environment jsdom
 */
import { MfaRequiredError } from "@/lib/auth/session-assurance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { SyncManager } from "./SyncManager";

const m = vi.hoisted(() => ({
  triggerSync: vi.fn(),
  assertDataApiAssurance: vi.fn(),
  requestMfaChallenge: vi.fn(),
  registerCurrentDevice: vi.fn(),
  watchForForcedSignOut: vi.fn(),
  startRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "u1" },
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => ({}) }));
vi.mock("@/lib/demo-data", () => ({
  clearDemoModeData: vi.fn(async () => {}),
}));
vi.mock("@/lib/sync", () => ({ triggerSync: m.triggerSync }));
vi.mock("@/lib/auth/session-assurance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session-assurance")>()),
  assertDataApiAssurance: m.assertDataApiAssurance,
}));
vi.mock("@/lib/auth/mfa-challenge-bus", () => ({
  requestMfaChallenge: m.requestMfaChallenge,
}));
vi.mock("@/lib/devices/registry", () => ({
  registerCurrentDevice: m.registerCurrentDevice,
}));
vi.mock("@/lib/devices/forced-signout", () => ({
  watchForForcedSignOut: m.watchForForcedSignOut,
}));
vi.mock("@/lib/sync/realtime", () => ({
  startRealtimeSubscription: m.startRealtimeSubscription,
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.requestMfaChallenge.mockResolvedValue(undefined);
  m.registerCurrentDevice.mockResolvedValue(undefined);
  m.watchForForcedSignOut.mockReturnValue({ unsubscribe: vi.fn() });
  m.startRealtimeSubscription.mockReturnValue({ unsubscribe: vi.fn() });
});
afterEach(cleanup);

function expectNoDataApiFollowUps() {
  expect(m.registerCurrentDevice).not.toHaveBeenCalled();
  expect(m.watchForForcedSignOut).not.toHaveBeenCalled();
  expect(m.startRealtimeSubscription).not.toHaveBeenCalled();
}

describe("SyncManager — second factor", () => {
  it("prompts for the second factor and starts nothing else when sync is refused", async () => {
    m.triggerSync.mockRejectedValue(new MfaRequiredError());
    render(<SyncManager />);
    await waitFor(() => expect(m.requestMfaChallenge).toHaveBeenCalledOnce());
    expectNoDataApiFollowUps();
  });

  it("re-checks assurance when triggerSync skipped (a sync was already running)", async () => {
    m.triggerSync.mockResolvedValue(null);
    m.assertDataApiAssurance.mockRejectedValue(new MfaRequiredError());
    render(<SyncManager />);
    await waitFor(() => expect(m.requestMfaChallenge).toHaveBeenCalledOnce());
    expectNoDataApiFollowUps();
  });

  it("does not prompt for other sync failures", async () => {
    m.triggerSync.mockRejectedValue(new Error("network down"));
    render(<SyncManager />);
    await waitFor(() => expect(m.triggerSync).toHaveBeenCalled());
    await Promise.resolve();
    expect(m.requestMfaChallenge).not.toHaveBeenCalled();
    expectNoDataApiFollowUps();
  });

  it("registers the device and subscribes once the session is cleared", async () => {
    m.triggerSync.mockResolvedValue({});
    m.assertDataApiAssurance.mockResolvedValue(undefined);
    render(<SyncManager />);
    await waitFor(() =>
      expect(m.startRealtimeSubscription).toHaveBeenCalledOnce(),
    );
    expect(m.registerCurrentDevice).toHaveBeenCalledOnce();
    expect(m.requestMfaChallenge).not.toHaveBeenCalled();
  });
});
