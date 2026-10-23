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
import { signOutAndClearLocal } from "./sign-out";

vi.mock("@/lib/db", () => ({ clearAllStores: vi.fn(async () => {}) }));

beforeEach(() => {
  window.localStorage.clear();
});

describe("signOutAndClearLocal", () => {
  it("forgets the last-known tier before the session is torn down", async () => {
    writeCachedTier("u1", "pro");
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
