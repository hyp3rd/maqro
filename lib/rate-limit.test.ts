import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for lib/rate-limit.ts - the rate-limit wrappers around
 *  the `check_throttle` Postgres function. The interesting
 *  behaviors:
 *
 *    - fail-open on infrastructure error (no Supabase config, RPC
 *      throws, malformed response). A throttle outage must NOT
 *      lock users out of auth - we'd rather rely on upstream
 *      firewall for catastrophic abuse than break sign-in.
 *    - response-shape robustness: Supabase returns table-returning
 *      functions as an array; the helper unwraps it but stays
 *      defensive against future shifts.
 *    - composed check (IP + target) short-circuits on the first
 *      failing bucket. IP fails first because it's the broader
 *      signal - blocking a hostile IP that hits many emails is
 *      higher priority than throttling one email seen from many
 *      IPs. */

const { mockGetSupabaseSecretConfig, mockRpc } = vi.hoisted(() => ({
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mockRpc })),
}));

async function loadLib() {
  vi.resetModules();
  return await import("./rate-limit");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit - single-bucket", () => {
  it("returns allowed on the first-allowed row shape from RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
      error: null,
    });
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:ip:1.2.3.4",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(true);
  });

  it("returns retry-after when RPC reports the bucket is over limit", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 6, retry_after_seconds: 42 }],
      error: null,
    });
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.retryAfterSeconds).toBe(42);
    }
  });

  it("fails OPEN when Supabase isn't configured", async () => {
    // The trade documented in the lib header: a Supabase outage
    // can't be allowed to lock users out of auth.
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails OPEN when the RPC itself errors", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "function not found" },
    });
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(true);
  });

  it("fails OPEN when the RPC throws (network glitch)", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network down"));
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(true);
  });

  it("fails OPEN when the response shape is unexpected", async () => {
    // Future Supabase SDK could shift the table-returning-function
    // shape; the helper shouldn't crash, it should degrade safely.
    mockRpc.mockResolvedValueOnce({
      data: "not an array or object",
      error: null,
    });
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(true);
  });

  it("falls back to 60s retry-after when the function returns no number", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ allowed: false }], error: null });
    const { checkRateLimit } = await loadLib();
    const res = await checkRateLimit({
      bucket: "test:x",
      limit: 5,
      windowSeconds: 60,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.retryAfterSeconds).toBe(60);
    }
  });
});

describe("checkAuthRateLimit - composed IP + target", () => {
  it("calls IP bucket first and short-circuits if it fails", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 99, retry_after_seconds: 30 }],
      error: null,
    });
    const { checkAuthRateLimit } = await loadLib();
    const res = await checkAuthRateLimit({
      surface: "recovery",
      ip: "1.2.3.4",
      target: "alice@example.com",
      ipLimit: 20,
      targetLimit: 3,
      windowSeconds: 3600,
    });
    expect(res.allowed).toBe(false);
    // Only the IP check ran - target check was skipped.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0]?.[1]).toMatchObject({
      p_bucket: "recovery:ip:1.2.3.4",
      p_limit: 20,
    });
  });

  it("runs the target bucket when IP passes", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [{ allowed: true, count: 5, retry_after_seconds: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
        error: null,
      });
    const { checkAuthRateLimit } = await loadLib();
    const res = await checkAuthRateLimit({
      surface: "recovery",
      ip: "1.2.3.4",
      target: "alice@example.com",
      ipLimit: 20,
      targetLimit: 3,
      windowSeconds: 3600,
    });
    expect(res.allowed).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[1]?.[1]).toMatchObject({
      p_bucket: "recovery:target:alice@example.com",
      p_limit: 3,
    });
  });

  it("skips the IP check when IP is null (local dev with no proxy chain)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
      error: null,
    });
    const { checkAuthRateLimit } = await loadLib();
    const res = await checkAuthRateLimit({
      surface: "recovery",
      ip: null,
      target: "alice@example.com",
      ipLimit: 20,
      targetLimit: 3,
      windowSeconds: 3600,
    });
    expect(res.allowed).toBe(true);
    // Only the target check ran.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0]?.[1]).toMatchObject({
      p_bucket: "recovery:target:alice@example.com",
    });
  });

  it("skips the target check when target is null", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
      error: null,
    });
    const { checkAuthRateLimit } = await loadLib();
    const res = await checkAuthRateLimit({
      surface: "recovery",
      ip: "1.2.3.4",
      target: null,
      ipLimit: 20,
      targetLimit: 3,
      windowSeconds: 3600,
    });
    expect(res.allowed).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0]?.[1]).toMatchObject({
      p_bucket: "recovery:ip:1.2.3.4",
    });
  });

  it("returns target-bucket retry-after when IP passes but target fails", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [{ allowed: true, count: 5, retry_after_seconds: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: false, count: 4, retry_after_seconds: 1200 }],
        error: null,
      });
    const { checkAuthRateLimit } = await loadLib();
    const res = await checkAuthRateLimit({
      surface: "recovery",
      ip: "1.2.3.4",
      target: "alice@example.com",
      ipLimit: 20,
      targetLimit: 3,
      windowSeconds: 3600,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.retryAfterSeconds).toBe(1200);
    }
  });
});

describe("ipFromRequest", () => {
  it("uses the leftmost x-forwarded-for entry", async () => {
    const { ipFromRequest } = await loadLib();
    const req = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
    });
    expect(ipFromRequest(req)).toBe("203.0.113.42");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", async () => {
    const { ipFromRequest } = await loadLib();
    const req = new Request("http://localhost/x", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(ipFromRequest(req)).toBe("198.51.100.7");
  });

  it("returns null when neither header is present (local dev)", async () => {
    const { ipFromRequest } = await loadLib();
    const req = new Request("http://localhost/x");
    expect(ipFromRequest(req)).toBeNull();
  });
});
