/**
 * @vitest-environment jsdom
 */
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
});
