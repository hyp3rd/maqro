/**
 * @vitest-environment jsdom
 */
import { useUser } from "@/hooks/use-user";
import { writeLastKnownUserId } from "@/lib/auth/last-known-user";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRetryableFetchError,
  type AuthChangeEvent,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { SyncManager } from "./SyncManager";

/** SyncManager with the REAL `useUser`: an expired session opened offline
 *  resolves to the last-known user (offline-unverified), which has no
 *  token — sync and its follow-ups (device registration, realtime, the
 *  forced-sign-out watcher) must not start on it. */

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  triggerSync: vi.fn(),
  registerCurrentDevice: vi.fn(),
  watchForForcedSignOut: vi.fn(),
  startRealtimeSubscription: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => mocks.client,
  // The expired session auth-js still keeps in storage belongs to u1.
  readStoredSessionUserId: () => Promise.resolve("u1"),
}));
vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  triggerSync: mocks.triggerSync,
}));
vi.mock("@/lib/demo-data", () => ({
  clearDemoModeData: () => Promise.resolve(),
}));
vi.mock("@/lib/auth/session-assurance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session-assurance")>()),
  assertDataApiAssurance: () => Promise.resolve(),
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

type GetUserResult = { data: { user: User | null }; error: AuthError | null };

const networkError = () => new AuthRetryableFetchError("Failed to fetch", 0);

/** A browser auth client whose `getUser()` answers `getUser`, with no
 *  usable session offline (the access token expired). */
function authClient(getUser: GetUserResult, session: Session | null) {
  return {
    auth: {
      getUser: () => Promise.resolve(getUser),
      getSession: () =>
        Promise.resolve(
          session === null
            ? { data: { session: null }, error: networkError() }
            : { data: { session }, error: null },
        ),
      onAuthStateChange: (
        callback: (event: AuthChangeEvent, s: Session | null) => void,
      ) => {
        queueMicrotask(() => callback("INITIAL_SESSION", session));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
}

/** Shows the auth state, so the test can wait for it to resolve. */
function AuthProbe() {
  const { isLoaded, localUserId, isOfflineUnverified } = useUser();
  return (
    <p data-testid="auth">
      {isLoaded
        ? `${localUserId ?? "none"}|${isOfflineUnverified ? "unverified" : "verified"}`
        : "loading"}
    </p>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.triggerSync.mockResolvedValue({ conflicts: [] });
  mocks.registerCurrentDevice.mockResolvedValue(undefined);
  mocks.watchForForcedSignOut.mockReturnValue({ unsubscribe: vi.fn() });
  mocks.startRealtimeSubscription.mockReturnValue({ unsubscribe: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe("SyncManager — offline-unverified", () => {
  it("does not start sync on the last-known user", async () => {
    writeLastKnownUserId("u1");
    mocks.client = authClient(
      { data: { user: null }, error: networkError() },
      null,
    );

    render(
      <>
        <AuthProbe />
        <SyncManager />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("auth").textContent).toBe("u1|unverified"),
    );
    await settle();

    expect(mocks.triggerSync).not.toHaveBeenCalled();
    expect(mocks.registerCurrentDevice).not.toHaveBeenCalled();
    expect(mocks.watchForForcedSignOut).not.toHaveBeenCalled();
    expect(mocks.startRealtimeSubscription).not.toHaveBeenCalled();
  });

  it("control: a verified session does start sync", async () => {
    const user = { id: "u1" } as User;
    mocks.client = authClient({ data: { user }, error: null }, {
      user,
    } as Session);

    render(
      <>
        <AuthProbe />
        <SyncManager />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("auth").textContent).toBe("u1|verified"),
    );
    await settle();

    expect(mocks.triggerSync).toHaveBeenCalledWith(expect.anything(), "u1");
  });
});
