/**
 * @vitest-environment jsdom
 */
import {
  readLastKnownUserId,
  writeLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { readCachedTier, writeCachedTier } from "@/lib/billing/tier-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearAccountRecords,
  clearAllAccountRecords,
  signOutAndClearLocal,
} from "./sign-out";

vi.mock("@/lib/db", () => ({ clearAllStores: vi.fn(async () => {}) }));

beforeEach(() => {
  window.localStorage.clear();
});

describe("signOutAndClearLocal", () => {
  it("forgets only the signed-out user's tier, keeping other accounts'", async () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    writeLastKnownUserId("u2");
    const supabase = {
      auth: { signOut: vi.fn(async () => ({ error: null })) },
    } as unknown as SupabaseClient;

    await signOutAndClearLocal(supabase);

    expect(readCachedTier("u2")).toBeNull();
    expect(readCachedTier("u1")).toBe("pro");
    expect(readLastKnownUserId()).toBeNull();
  });

  it("forgets the account it is given even when the last-known record names another", async () => {
    // The record can be stale (an older bundle switched accounts without
    // updating it); the caller's signed-in user is the account signing out.
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    writeLastKnownUserId("u2");
    const supabase = {
      auth: { signOut: vi.fn(async () => ({ error: null })) },
    } as unknown as SupabaseClient;

    await signOutAndClearLocal(supabase, "u1");

    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("plus");
    expect(readLastKnownUserId()).toBeNull();
  });

  it("forgets the last-known tier before the session is torn down", async () => {
    writeCachedTier("u1", "pro");
    writeLastKnownUserId("u1");
    let cachedAtSignOut: string | null = "unset";
    const supabase = {
      auth: {
        signOut: vi.fn(async () => {
          cachedAtSignOut = readCachedTier("u1");
          return { error: null };
        }),
      },
    } as unknown as SupabaseClient;

    await signOutAndClearLocal(supabase);

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(cachedAtSignOut).toBeNull();
    expect(readCachedTier("u1")).toBeNull();
  });

  it("forgets the last-known user even when signOut() cannot load the session", async () => {
    // Offline with an expired access token, auth-js's signOut() returns the
    // retryable session error without firing SIGNED_OUT — the record must
    // not depend on that event.
    writeLastKnownUserId("u1");
    let recordedAtSignOut: string | null = "unset";
    const supabase = {
      auth: {
        signOut: vi.fn(async () => {
          recordedAtSignOut = readLastKnownUserId();
          return { error: new Error("Failed to fetch") };
        }),
      },
    } as unknown as SupabaseClient;

    await signOutAndClearLocal(supabase);

    expect(recordedAtSignOut).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });
});

describe("clearAccountRecords", () => {
  it("with no last-known user, whose tier it is is unknown: forgets every tier", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    clearAccountRecords();
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBeNull();
  });

  it("an explicit account wins over the last-known record", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    writeLastKnownUserId("u2");
    clearAccountRecords("u1");
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("plus");
    expect(readLastKnownUserId()).toBeNull();
  });

  it("an explicit account with no record forgets only that account's tier", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    clearAccountRecords("u1");
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("plus");
  });
});

describe("clearAllAccountRecords", () => {
  it("forgets every account's tier and the last-known user (device reset)", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    writeLastKnownUserId("u2");
    clearAllAccountRecords();
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });
});
