import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSupabaseSecretConfig, mockRpc } = vi.hoisted(() => ({
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockRpc: vi.fn(async () => ({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  })),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mockRpc })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/signup-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  });
});

describe("POST /api/auth/signup-check - input validation", () => {
  it("returns 400 for non-JSON body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("invalid-email");
  });

  it("returns 400 for malformed email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/signup-check - disposable-domain block", () => {
  it("returns 422 + 'disposable-domain' reason for a throwaway address", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice@mailinator.com" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("disposable-domain");
    expect(body.error).toMatch(/disposable/i);
    // Should bail BEFORE consulting the rate-limit RPC - no point
    // touching Supabase when the email is already rejected.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup-check - rate limiting", () => {
  it("returns 429 with Retry-After when the throttle rejects", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 10, retry_after_seconds: 3600 }],
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice@example.com" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("rate-limited");
  });
});

describe("POST /api/auth/signup-check - Turnstile gate", () => {
  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("403s on an invalid Turnstile token (configured), before any email/throttle work", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
        { status: 200 },
      ),
    );
    const { POST } = await loadRoute();
    const res = await POST(
      req({ email: "alice@example.com", turnstileToken: "bad" }),
    );
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup-check - happy path", () => {
  it("returns 200 ok for a legitimate signup", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("normalizes the email to lowercase before rate-limit lookup", async () => {
    const { POST } = await loadRoute();
    await POST(req({ email: "  Alice@Example.COM  " }));
    // The throttle's `p_bucket` arg should contain the lowercased
    // address, not the raw input - otherwise an attacker bypasses
    // the per-email cap by varying case. The RPC is called twice
    // (per-IP, then per-target); the per-target call is the one
    // that includes the email in the bucket name.
    const calls = mockRpc.mock.calls as unknown as Array<
      [string, { p_bucket: string }]
    >;
    const emailCall = calls.find(([, args]) =>
      args.p_bucket.includes("target"),
    );
    expect(emailCall?.[1].p_bucket).toContain("alice@example.com");
  });
});
