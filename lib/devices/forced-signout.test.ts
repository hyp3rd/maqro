/**
 * @vitest-environment jsdom
 */
import {
  readLastKnownUserId,
  writeLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { readCachedTier, writeCachedTier } from "@/lib/billing/tier-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchForForcedSignOut } from "./forced-signout";

const mocks = vi.hoisted(() => ({
  clearAllStores: vi.fn(async () => {}),
  getCurrentSessionId: vi.fn(async () => "sid-mine"),
}));
vi.mock("@/lib/db", () => ({ clearAllStores: mocks.clearAllStores }));
vi.mock("./registry", () => ({
  getCurrentSessionId: mocks.getCurrentSessionId,
}));

type DeleteHandler = (payload: { old: { session_id?: string } }) => void;

/** A client whose realtime channel hands the DELETE handler to the test. */
function fakeClient() {
  const state = { onDelete: null as DeleteHandler | null };
  const channel = {
    on: (_type: string, _filter: unknown, handler: DeleteHandler) => {
      state.onDelete = handler;
      return channel;
    },
    subscribe: () => channel,
  };
  const signOut = vi.fn(async () => ({ error: null }));
  const client = {
    channel: () => channel,
    removeChannel: vi.fn(async () => "ok"),
    auth: { signOut },
  } as unknown as SupabaseClient;
  return {
    client,
    signOut,
    deleteRow: (sid: string) => state.onDelete?.({ old: { session_id: sid } }),
  };
}

/** The watcher captures its own session id asynchronously; a macrotask
 *  boundary lets that promise chain settle. */
function sessionIdCaptured(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const assign = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watchForForcedSignOut", () => {
  it("a disconnect of this session wipes the per-account records before signing out", async () => {
    writeCachedTier("u1", "pro");
    writeLastKnownUserId("u1");
    const { client, signOut, deleteRow } = fakeClient();
    let recordedAtSignOut: string | null = "unset";
    signOut.mockImplementation(async () => {
      recordedAtSignOut = readLastKnownUserId();
      return { error: null };
    });

    watchForForcedSignOut(client, "u1");
    await sessionIdCaptured();
    deleteRow("sid-mine");

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/login?disconnected=1"),
    );
    expect(mocks.clearAllStores).toHaveBeenCalledTimes(1);
    expect(recordedAtSignOut).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
    expect(readCachedTier("u1")).toBeNull();
  });

  it("forgets the disconnected account's tier, not the one a stale record names", async () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    // Stale: an older bundle switched accounts without updating the record.
    writeLastKnownUserId("u2");
    const { client, deleteRow } = fakeClient();

    watchForForcedSignOut(client, "u1");
    await sessionIdCaptured();
    deleteRow("sid-mine");

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/login?disconnected=1"),
    );
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("plus");
    expect(readLastKnownUserId()).toBeNull();
  });

  it("another session's disconnect leaves this device alone", async () => {
    writeLastKnownUserId("u1");
    const { client, signOut, deleteRow } = fakeClient();

    watchForForcedSignOut(client, "u1");
    await sessionIdCaptured();
    deleteRow("sid-other");
    await sessionIdCaptured();

    expect(signOut).not.toHaveBeenCalled();
    expect(readLastKnownUserId()).toBe("u1");
  });
});
