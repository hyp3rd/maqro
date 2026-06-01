import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/onboarding/events — the anonymous funnel
 *  counter endpoint. Validation is strict (step shape, action
 *  allowlist) and the route is intentionally silent on
 *  unconfigured-Supabase (204) so the wizard doesn't error out on
 *  local dev. */

const { mockCheckAuthRateLimit, mockGetSupabaseSecretConfig, mockRpc } =
  vi.hoisted(() => ({
    // Widened so per-test overrides can return the 429 shape.
    mockCheckAuthRateLimit: vi.fn() as ReturnType<typeof vi.fn>,
    mockGetSupabaseSecretConfig: vi.fn(
      () =>
        ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
          url: string;
          secretKey: string;
        } | null,
    ),
    // Widened so the failure-path test can return `{ error: { message } }`.
    mockRpc: vi.fn() as ReturnType<typeof vi.fn>,
  }));

vi.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: mockCheckAuthRateLimit,
  ipFromRequest: () => null,
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
  return new Request("http://localhost/api/onboarding/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  mockRpc.mockResolvedValue({ error: null });
});

describe("POST /api/onboarding/events — validation", () => {
  it("400s on non-JSON body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400s when step isn't an integer", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 1.5, action: "enter" }));
    expect(res.status).toBe(400);
  });

  it("400s on negative step", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ step: -1, action: "enter" }));
    expect(res.status).toBe(400);
  });

  it("400s on step >= 64 (matches DB constraint)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 64, action: "enter" }));
    expect(res.status).toBe(400);
  });

  it("400s on unknown action", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 0, action: "next" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/onboarding/events — rate limit", () => {
  it("returns 429 + Retry-After when rate-limited", async () => {
    mockCheckAuthRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 0, action: "enter" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/onboarding/events — unconfigured", () => {
  it("204s silently when Supabase isn't configured (local dev)", async () => {
    // Intentional: the wizard runs even without Supabase wired up
    // (guest mode on local dev), and a 5xx here would surface in
    // the user's console for no actionable reason. The lost counter
    // is operationally invisible.
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 0, action: "enter" }));
    expect(res.status).toBe(204);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/onboarding/events — happy path", () => {
  it("calls the bump_onboarding_counter RPC + returns 204", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 2, action: "enter" }));
    expect(res.status).toBe(204);
    expect(mockRpc).toHaveBeenCalledWith("bump_onboarding_counter", {
      p_step: 2,
      p_action: "enter",
    });
  });

  it("accepts the three terminal actions: enter, skip, finish", async () => {
    const { POST } = await loadRoute();
    for (const action of ["enter", "skip", "finish"] as const) {
      const res = await POST(req({ step: 0, action }));
      expect(res.status).toBe(204);
    }
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  it("500s when the RPC errors", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "rls denied" } });
    const { POST } = await loadRoute();
    const res = await POST(req({ step: 0, action: "enter" }));
    expect(res.status).toBe(500);
  });
});
