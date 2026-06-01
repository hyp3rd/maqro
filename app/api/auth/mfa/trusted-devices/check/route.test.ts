import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/auth/mfa/trusted-devices/check — the
 *  hot-path "is this device trusted right now?" lookup. The
 *  load-bearing contract is **default-deny**: every error mode
 *  (no Supabase, no session, no deviceId, RLS denial, DB error,
 *  genuinely-not-trusted) collapses to `{ trusted: false }`. A
 *  failure that resolved to `trusted: true` would auto-skip MFA
 *  for an attacker, so the test set asserts each route into the
 *  `false` branch explicitly. */

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockSelectMaybeSingle,
  mockAdminUpdateThen,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockSelectMaybeSingle: vi.fn(),
  // Admin client's `last_used_at` bump is fire-and-forget; we
  // capture the `then(()=>{})` chain so the test environment
  // doesn't fail on an unhandled promise.
  mockAdminUpdateThen: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      update: () => ({ eq: () => ({ then: mockAdminUpdateThen }) }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/auth/mfa/trusted-devices/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ gt: () => ({ maybeSingle: mockSelectMaybeSingle }) }),
        }),
      }),
    }),
  });
  mockSelectMaybeSingle.mockResolvedValue({
    data: { id: "trust-1" },
    error: null,
  });
  mockAdminUpdateThen.mockImplementation((cb: () => void) => {
    cb();
    return Promise.resolve();
  });
});

describe("POST /api/auth/mfa/trusted-devices/check — default-deny paths", () => {
  it("returns { trusted: false } when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ deviceId: "dev-1" }));
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });

  it("returns 401 + { trusted: false } when not authenticated", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });

  it("returns { trusted: false } when the body is not JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/auth/mfa/trusted-devices/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });

  it("returns { trusted: false } when deviceId is missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({}));
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });

  it("returns { trusted: false } when the row is not found", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ deviceId: "dev-not-trusted" }));
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });

  it("returns { trusted: false } when the SELECT errors (RLS denial)", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "RLS denied" },
    });
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ deviceId: "dev-1" }));
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(false);
  });
});

describe("POST /api/auth/mfa/trusted-devices/check — trusted path", () => {
  it("returns { trusted: true } when an unexpired row matches", async () => {
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ deviceId: "dev-1" }));
    const body = (await res.json()) as { trusted: boolean };
    expect(body.trusted).toBe(true);
  });

  it("kicks off a last_used_at bump on the matched row", async () => {
    const { POST } = await loadRoute();
    await POST(jsonReq({ deviceId: "dev-1" }));
    // The bump is fire-and-forget — assert the admin update chain
    // was entered (the thenable resolved). Failure to bump must NOT
    // change the trusted outcome, but skipping the bump silently
    // would mean Settings "last used" stamps go stale.
    expect(mockAdminUpdateThen).toHaveBeenCalled();
  });
});
