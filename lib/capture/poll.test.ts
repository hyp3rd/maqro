import { describe, expect, it, vi } from "vitest";
import { pollCapture } from "./poll";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pollCapture", () => {
  it("returns 'ready' on the first poll when the server reports ready", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ ready: true, kind: "barcode", barcode: "1234567890123" }),
    ) as unknown as typeof fetch;
    const controller = new AbortController();

    const result = await pollCapture("abc", controller.signal, {
      fetcher,
      sleep: () => Promise.resolve(),
      intervalMs: 1,
      totalTimeoutMs: 1000,
    });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready" && result.payload.ready) {
      expect(result.payload.kind).toBe("barcode");
    }
  });

  it("polls until 'ready' arrives and ignores 'ready: false' responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ready: false }))
      .mockResolvedValueOnce(jsonResponse({ ready: false }))
      .mockResolvedValueOnce(
        jsonResponse({ ready: true, kind: "photo", photoPath: "p" }),
      ) as unknown as typeof fetch;
    const result = await pollCapture("abc", new AbortController().signal, {
      fetcher,
      sleep: () => Promise.resolve(),
      intervalMs: 1,
      totalTimeoutMs: 5_000,
    });
    expect(result.kind).toBe("ready");
    expect(
      (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    ).toHaveLength(3);
  });

  it("returns 'expired' on 404 (session is fatal-gone)", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Session not found." }, 404),
    ) as unknown as typeof fetch;
    const result = await pollCapture("abc", new AbortController().signal, {
      fetcher,
      sleep: () => Promise.resolve(),
      intervalMs: 1,
      totalTimeoutMs: 1000,
    });
    expect(result.kind).toBe("expired");
  });

  it("returns 'aborted' when the signal fires mid-loop", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    controller.abort();
    const result = await pollCapture("abc", controller.signal, {
      fetcher,
      sleep: () => Promise.resolve(),
      intervalMs: 1,
      totalTimeoutMs: 1000,
    });
    expect(result.kind).toBe("aborted");
  });

  it("backs off (interval grows) on network errors then returns 'timeout'", async () => {
    let pollCount = 0;
    const fetcher = vi.fn(async () => {
      pollCount++;
      throw new Error("network");
    }) as unknown as typeof fetch;
    // Capture the sleep durations to confirm backoff.
    const sleeps: number[] = [];
    const result = await pollCapture("abc", new AbortController().signal, {
      fetcher,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      intervalMs: 100,
      totalTimeoutMs: 1500,
    });
    expect(result.kind).toBe("timeout");
    // Doubles capped at 8000: 100 → 200 → 400 → 800 → 1600→cap
    // The exact count depends on totalTimeoutMs but the first few
    // should clearly grow.
    expect(sleeps.length).toBeGreaterThan(1);
    expect(sleeps[0]).toBe(100);
    expect(sleeps[1]).toBeGreaterThanOrEqual(200);
    expect(pollCount).toBeGreaterThan(1);
  });
});
