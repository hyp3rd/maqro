/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSubscriptionStatus } from "./use-subscription-status";

// The hook now gates the fetch on an active session. Mock `useUser` —
// signed-in by default so the fetch path runs; flip `current` to null
// per-test to exercise the signed-out gate.
const mockUser = vi.hoisted(() => ({
  current: { id: "u1" } as { id: string } | null,
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: mockUser.current,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));

/** Helpers — the hook's only external dep is `fetch('/api/billing/usage')`.
 *  Stub `global.fetch` with controllable responses. */
function mockUsageResponse(body: unknown, options: { status?: number } = {}) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      json: () => Promise.resolve(body),
    } as Response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  // Ensure each test starts from a clean slate.
  vi.restoreAllMocks();
  mockUser.current = { id: "u1" }; // signed in by default
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSubscriptionStatus", () => {
  it("starts in 'loading' before the fetch resolves", () => {
    mockUsageResponse({ subscriptionStatus: "active" });
    const { result } = renderHook(() => useSubscriptionStatus());
    expect(result.current.kind).toBe("loading");
  });

  it("maps a recognized status to 'known'", async () => {
    mockUsageResponse({ subscriptionStatus: "past_due" });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).not.toBe("loading"));
    expect(result.current).toEqual({ kind: "known", status: "past_due" });
  });

  it("represents null subscriptionStatus as 'known' with null status", async () => {
    // Free / never-subscribed user: the route returns null for
    // subscriptionStatus. We want the UI to treat that as "no
    // subscription state to act on" — not unknown, not error.
    mockUsageResponse({ subscriptionStatus: null });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).not.toBe("loading"));
    expect(result.current).toEqual({ kind: "known", status: null });
  });

  it("returns 'unknown' for a future Stripe status we don't list", async () => {
    // Defensive — if Stripe ever adds a new status (e.g., `paused`)
    // we shouldn't break the UI by claiming it's an error. The
    // hook returns the raw value and lets callers branch.
    mockUsageResponse({ subscriptionStatus: "paused" });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).not.toBe("loading"));
    expect(result.current).toEqual({ kind: "unknown", raw: "paused" });
  });

  it("returns 'anon' on 401", async () => {
    mockUsageResponse({ error: "Not authenticated." }, { status: 401 });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).toBe("anon"));
  });

  it("returns 'anon' without fetching when signed out", async () => {
    // The gate: a guest shouldn't fire a guaranteed-401 at the auth-only route.
    mockUser.current = null;
    const fetchMock = mockUsageResponse({ subscriptionStatus: "active" });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).toBe("anon"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'error' on other failure statuses", async () => {
    mockUsageResponse({ error: "boom" }, { status: 500 });
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).toBe("error"));
    if (result.current.kind === "error") {
      expect(result.current.message).toBe("boom");
    }
  });

  it("returns 'error' on a network throw", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useSubscriptionStatus());
    await waitFor(() => expect(result.current.kind).toBe("error"));
  });
});
