/**
 * @vitest-environment jsdom
 */
import { APP_VERSION } from "@/lib/version";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVersionCheck } from "./use-version-check";

// Helper — `fetch` is what the hook polls. We replace `global.fetch`
// with a vi.fn that the test controls.
function mockVersionResponse(version: string, ok = true): void {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve({ version }),
    } as Response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVersionCheck", () => {
  it("returns null while server version matches the bundle", async () => {
    mockVersionResponse(APP_VERSION);
    const { result } = renderHook(() => useVersionCheck());
    // Advance past the initial 5s delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.newVersion).toBeNull();
  });

  it("surfaces the new version when the server reports a mismatch", async () => {
    mockVersionResponse("99.99.99");
    const { result } = renderHook(() => useVersionCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.newVersion).toBe("99.99.99");
  });

  it("swallows fetch failures without throwing", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useVersionCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    // Hook stays at null instead of throwing — that's the
    // contract: transient failures should never break the UI.
    expect(result.current.newVersion).toBeNull();
  });

  it("ignores non-OK responses", async () => {
    mockVersionResponse("99.99.99", false);
    const { result } = renderHook(() => useVersionCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.newVersion).toBeNull();
  });

  it("ignores responses missing a version field", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ unrelated: "payload" }),
      } as Response),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useVersionCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.newVersion).toBeNull();
  });

  it("clears intervals on unmount", async () => {
    mockVersionResponse(APP_VERSION);
    const { unmount } = renderHook(() => useVersionCheck());
    unmount();
    // After unmount, advancing time should not produce additional
    // fetch calls. We assert the fetch count stays at 0 (initial
    // 5s timer never fired) or whatever it was before unmount.
    const callsBefore = (
      global.fetch as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    const callsAfter = (
      global.fetch as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });
});
