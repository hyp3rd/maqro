/**
 * @vitest-environment jsdom
 */
import { readCachedTier, writeCachedTier } from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  AiUsageProvider,
  resolveTierState,
  useAiUsage,
  useTier,
} from "./use-ai-usage";

/** The shared, cached tier source. The gate a Pro user's phase targets hang
 *  on must survive an offline/failed usage fetch (last-known tier), must
 *  never outlive the account it belongs to, and must never grant more than
 *  the server's latest answer. */

const auth = vi.hoisted(() => ({ user: null as User | null, isLoaded: true }));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: auth.user,
    isLoaded: auth.isLoaded,
    isUnconfigured: false,
  }),
}));

const fetchMock = vi.fn<(input: string) => Promise<Response>>();

function asUser(id: string): User {
  return { id } as User;
}

function usageResponse(tier: Tier): Response {
  return new Response(
    JSON.stringify({
      used: 0,
      cap: tier === "pro" ? null : 25,
      tier,
      isPremium: tier !== "free",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function wrapper({ children }: { children: ReactNode }) {
  return <AiUsageProvider>{children}</AiUsageProvider>;
}

beforeEach(() => {
  auth.user = asUser("u1");
  auth.isLoaded = true;
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("resolveTierState", () => {
  const cachedPro = () => "pro" as const;
  const none = () => null;

  it("a live answer always wins over the cache", () => {
    expect(
      resolveTierState(
        {
          status: "ok",
          data: { used: 0, cap: 25, tier: "free", isPremium: false },
        },
        cachedPro,
      ),
    ).toEqual({ tier: "free", resolved: true });
  });

  it("the cache is consulted only when the live request failed", () => {
    expect(resolveTierState({ status: "loading" }, cachedPro)).toEqual({
      tier: null,
      resolved: false,
    });
    expect(resolveTierState({ status: "anon" }, cachedPro)).toEqual({
      tier: null,
      resolved: true,
    });
    expect(
      resolveTierState({ status: "error", message: "x" }, cachedPro),
    ).toEqual({ tier: "pro", resolved: true });
    expect(resolveTierState({ status: "error", message: "x" }, none)).toEqual({
      tier: null,
      resolved: false,
    });
  });
});

describe("AiUsageProvider / useTier", () => {
  it("serves the live tier and remembers it for this user", async () => {
    fetchMock.mockResolvedValue(usageResponse("pro"));
    const { result } = renderHook(() => useTier(), { wrapper });
    await waitFor(() => expect(result.current.tier).toBe("pro"));
    expect(result.current.resolved).toBe(true);
    expect(readCachedTier("u1")).toBe("pro");
  });

  it("offline: keeps the last-known tier when the usage fetch fails", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockImplementation(offline);
    const { result } = renderHook(() => useTier(), { wrapper });
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.tier).toBe("pro");
  });

  it("keeps the last-known tier when a later refresh fails (HTTP error)", async () => {
    fetchMock.mockResolvedValueOnce(usageResponse("pro"));
    const { result } = renderHook(
      () => ({ tier: useTier(), usage: useAiUsage() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tier.tier).toBe("pro"));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    act(() => result.current.usage.refresh());
    await waitFor(() =>
      expect(result.current.usage.state.status).toBe("error"),
    );
    expect(result.current.tier).toEqual({ tier: "pro", resolved: true });
  });

  it("with nothing cached, a failed fetch leaves the gate unresolved", async () => {
    fetchMock.mockImplementation(offline);
    const { result } = renderHook(
      () => ({ tier: useTier(), usage: useAiUsage() }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.usage.state.status).toBe("error"),
    );
    expect(result.current.tier).toEqual({ tier: null, resolved: false });
  });

  it("never upgrades beyond the server: a downgrade overwrites the cache", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockResolvedValueOnce(usageResponse("free"));
    const { result } = renderHook(
      () => ({ tier: useTier(), usage: useAiUsage() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tier.tier).toBe("free"));
    expect(readCachedTier("u1")).toBe("free");

    // Now offline: the stale "pro" must not come back.
    fetchMock.mockImplementation(offline);
    act(() => result.current.usage.refresh());
    await waitFor(() =>
      expect(result.current.usage.state.status).toBe("error"),
    );
    expect(result.current.tier).toEqual({ tier: "free", resolved: true });
  });

  it("a user switch never inherits the previous account's tier", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockImplementation(offline);
    auth.user = asUser("u2");
    const { result } = renderHook(
      () => ({ tier: useTier(), usage: useAiUsage() }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.usage.state.status).toBe("error"),
    );
    expect(result.current.tier).toEqual({ tier: null, resolved: false });
  });

  it("an in-session account switch drops the previous user's live answer", async () => {
    fetchMock.mockResolvedValueOnce(usageResponse("pro"));
    const { result, rerender } = renderHook(() => useTier(), { wrapper });
    await waitFor(() => expect(result.current.tier).toBe("pro"));

    // u2's request never settles during the assertion window.
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    auth.user = asUser("u2");
    rerender();
    expect(result.current).toEqual({ tier: null, resolved: false });
  });

  it("signed out: no tier, resolved, and no fetch", () => {
    writeCachedTier("u1", "pro");
    auth.user = null;
    const { result } = renderHook(() => useTier(), { wrapper });
    expect(result.current).toEqual({ tier: null, resolved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 401 (session gone) clears the cached tier", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const { result } = renderHook(() => useTier(), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual({ tier: null, resolved: true }),
    );
    expect(readCachedTier("u1")).toBeNull();
  });

  it("every reader under one provider shares a single fetch", async () => {
    fetchMock.mockResolvedValue(usageResponse("pro"));
    const { result } = renderHook(
      () => ({ a: useTier(), b: useTier(), usage: useAiUsage() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.a.tier).toBe("pro"));
    expect(result.current.b).toEqual(result.current.a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when used outside the provider", () => {
    // React logs the render error; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTier())).toThrow(/AiUsageProvider/);
    spy.mockRestore();
  });
});
