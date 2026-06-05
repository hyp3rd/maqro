import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for the /api/cron/status-probe Vercel cron handler.
 *
 *  The handler does three things: auth-gate on CRON_SECRET, run
 *  the dependency checks in-process via `runAllChecks()`, and
 *  insert one row into status_probes (then prune old ones). Each
 *  branch needs to be checked because a regression here goes
 *  silent — the /status page would just show a gap in the chart
 *  with no error surface.
 *
 *  Probe-path note: the cron used to HTTP-fetch /api/health, and
 *  the previous test fixture mocked `globalThis.fetch`. The route
 *  now calls `runAllChecks` directly from `lib/health/checks`, so
 *  we mock that module instead — same coverage shape, more
 *  faithful to the runtime path. */

const { mockGetSupabaseSecretConfig, mockInsert, mockLtEq, mockRunAllChecks } =
  vi.hoisted(() => ({
    mockGetSupabaseSecretConfig: vi.fn(
      () =>
        ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
          url: string;
          secretKey: string;
        } | null,
    ),
    mockInsert: vi.fn(async () => ({ error: null })) as ReturnType<
      typeof vi.fn
    >,
    mockLtEq: vi.fn(async () => ({ error: null })) as ReturnType<typeof vi.fn>,
    // Widened so per-test overrides can return any HealthSnapshot.
    mockRunAllChecks: vi.fn() as ReturnType<typeof vi.fn>,
  }));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/health/checks", () => ({ runAllChecks: mockRunAllChecks }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ insert: mockInsert, delete: () => ({ lt: mockLtEq }) }),
  })),
}));

const originalEnv = process.env.CRON_SECRET;

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function authedReq(): Request {
  return new Request("http://localhost/api/cron/status-probe", {
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  mockInsert.mockResolvedValue({ error: null });
  mockLtEq.mockResolvedValue({ error: null });
  // Default: healthy snapshot.
  mockRunAllChecks.mockResolvedValue({
    ok: true,
    version: "0.1.55",
    time: "2026-05-25T12:00:00Z",
    checks: { supabase: "ok", stripe: "ok", upstash: "ok" },
  });
});

afterEach(() => {
  process.env.CRON_SECRET = originalEnv;
});

describe("GET /api/cron/status-probe — auth", () => {
  it("503s when CRON_SECRET isn't configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(503);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockRunAllChecks).not.toHaveBeenCalled();
  });

  it("401s when the bearer secret doesn't match", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new Request("http://x", { headers: { authorization: "Bearer wrong" } }),
    );
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("503s when the service-role key isn't configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(503);
  });
});

describe("GET /api/cron/status-probe — probe + persist", () => {
  it("records overall_ok=true with per-component status on a healthy snapshot", async () => {
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    expect(mockRunAllChecks).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        overall_ok: true,
        supabase_status: "ok",
        stripe_status: "ok",
        upstash_status: "ok",
        http_status: 200,
        app_version: "0.1.55",
      }),
    );
  });

  it("records overall_ok=false with http_status=503 when Supabase fails", async () => {
    mockRunAllChecks.mockResolvedValueOnce({
      ok: false,
      version: "0.1.55",
      time: "2026-05-25T12:00:00Z",
      checks: { supabase: "fail", stripe: "ok", upstash: "ok" },
    });
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        overall_ok: false,
        supabase_status: "fail",
        stripe_status: "ok",
        http_status: 503,
      }),
    );
  });

  it("records a `skipped` dependency status faithfully (preview env)", async () => {
    // The runAllChecks helper returns `skipped` when an env var is
    // missing. The row should preserve that signal so the /status
    // page can distinguish "Stripe broken" from "Stripe not
    // configured here".
    mockRunAllChecks.mockResolvedValueOnce({
      ok: true,
      version: "0.1.55",
      time: "2026-05-25T12:00:00Z",
      checks: { supabase: "ok", stripe: "skipped", upstash: "skipped" },
    });
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_status: "skipped", http_status: 200 }),
    );
  });

  it("500s + does not prune when the insert fails", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "rls denied" } });
    const { GET } = await loadRoute();
    const res = await GET(authedReq());
    expect(res.status).toBe(500);
    expect(mockLtEq).not.toHaveBeenCalled();
  });

  it("runs the retention prune after a successful insert", async () => {
    const { GET } = await loadRoute();
    await GET(authedReq());
    expect(mockLtEq).toHaveBeenCalledTimes(1);
    const [cutoffField, cutoffValue] = mockLtEq.mock.calls[0] ?? [];
    expect(cutoffField).toBe("probed_at");
    expect(typeof cutoffValue).toBe("string");
    // Cutoff is 90 days ago — sanity-check it parses to a date in
    // that ballpark.
    const cutoffMs = Date.parse(cutoffValue as string);
    const expectedMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5_000);
  });
});
