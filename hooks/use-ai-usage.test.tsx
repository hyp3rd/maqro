/**
 * @vitest-environment jsdom
 */
import { readCachedTier, writeCachedTier } from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  AiUsageProvider,
  USAGE_FETCH_TIMEOUT_MS,
  resolveTierState,
  useAiUsage,
  useRefreshAiUsage,
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

const fetchMock =
  vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

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

/** A free user's usage counter at `used` of 10. */
function usedResponse(used: number): Response {
  return new Response(
    JSON.stringify({ used, cap: 10, tier: "free", isPremium: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Degraded network ("lie-fi"): the request never answers, and only
 *  rejects when its signal aborts — what a real fetch does. */
function hang(_input: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

/** A live-usage reader, like Profile's AI usage card. */
function UsageReader() {
  const { state } = useAiUsage();
  return (
    <p data-testid="usage">
      {state.status === "ok" ? `used ${state.data.used}` : state.status}
    </p>
  );
}

/** The app shell: a tier reader that is always mounted, and a usage reader
 *  that mounts only when its view opens. */
function Shell({ profileOpen }: { profileOpen: boolean }) {
  useTier();
  return profileOpen ? <UsageReader /> : null;
}

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

  it("a usage reader mounted later re-fetches and shows the newer count", async () => {
    fetchMock
      .mockResolvedValueOnce(usedResponse(2))
      .mockResolvedValueOnce(usedResponse(5));
    const { rerender } = render(
      <AiUsageProvider>
        <Shell profileOpen={false} />
      </AiUsageProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Let the app-load answer (2) settle before the user opens Profile.
    await act(async () => {});

    // AI calls happened elsewhere in the meantime; opening Profile must not
    // show the app-load count.
    rerender(
      <AiUsageProvider>
        <Shell profileOpen />
      </AiUsageProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("usage").textContent).toBe("used 5"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("readers mounting with the provider share its first fetch", async () => {
    fetchMock.mockResolvedValue(usedResponse(3));
    render(
      <AiUsageProvider>
        <Shell profileOpen />
        <UsageReader />
      </AiUsageProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("usage")[0]?.textContent).toBe("used 3"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useRefreshAiUsage re-fetches on demand and never fetches by itself", async () => {
    fetchMock
      .mockResolvedValueOnce(usageResponse("free"))
      .mockResolvedValueOnce(usageResponse("pro"));
    const { result } = renderHook(
      () => ({ tier: useTier(), refresh: useRefreshAiUsage() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tier.tier).toBe("free"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.tier.tier).toBe("pro"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a superseded request is aborted", async () => {
    fetchMock
      .mockImplementationOnce(hang)
      .mockResolvedValueOnce(usedResponse(1));
    const { result } = renderHook(() => useRefreshAiUsage(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  describe("degraded network (fetch hangs instead of rejecting)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("times out into the error path, where the cached tier applies", async () => {
      writeCachedTier("u1", "pro");
      fetchMock.mockImplementation(hang);
      const { result } = renderHook(
        () => ({ tier: useTier(), usage: useAiUsage() }),
        { wrapper },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_FETCH_TIMEOUT_MS - 1);
      });
      // Still inside the budget: no answer yet, so no tier.
      expect(result.current.usage.state.status).toBe("loading");
      expect(result.current.tier).toEqual({ tier: null, resolved: false });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.usage.state.status).toBe("error");
      expect(result.current.tier).toEqual({ tier: "pro", resolved: true });
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it("a response inside the budget is never cut off", async () => {
      fetchMock.mockResolvedValue(usageResponse("pro"));
      const { result } = renderHook(() => useAiUsage(), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state.status).toBe("ok");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_FETCH_TIMEOUT_MS * 2);
      });
      expect(result.current.state.status).toBe("ok");
    });
  });

  it("throws when used outside the provider", () => {
    // React logs the render error; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTier())).toThrow(/AiUsageProvider/);
    spy.mockRestore();
  });
});
