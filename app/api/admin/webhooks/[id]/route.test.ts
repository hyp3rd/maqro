import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for GET /api/admin/webhooks/[id] — the single-event
 *  detail endpoint. Mirrors the sibling `replay/route.test.ts`
 *  test shape so a future refactor of admin webhook tests can
 *  share a helper without each file having gone its own way. */

const { mockRequireAdmin, mockGetSupabaseSecretConfig, mockFetchMaybeSingle } =
  vi.hoisted(() => ({
    mockRequireAdmin: vi.fn(),
    // Cast widens the inferred return so the "unconfigured" test
    // can override with `null`.
    mockGetSupabaseSecretConfig: vi.fn(
      () =>
        ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
          url: string;
          secretKey: string;
        } | null,
    ),
    mockFetchMaybeSingle: vi.fn(),
  }));

vi.mock("@/lib/rbac", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockFetchMaybeSingle }) }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

const reqStub = new Request("http://localhost/api/admin/webhooks/anything");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockFetchMaybeSingle.mockResolvedValue({
    data: {
      id: "evt_abc",
      type: "customer.subscription.updated",
      payload: { id: "evt_abc" },
    },
    error: null,
  });
});

describe("GET /api/admin/webhooks/[id] — guards", () => {
  it("returns the guard response when caller is not admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res).toBe(forbidden);
    expect(mockFetchMaybeSingle).not.toHaveBeenCalled();
  });

  it("returns 400 when the id doesn't start with evt_", async () => {
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "not-stripe-shaped" }),
    });
    expect(res.status).toBe(400);
    expect(mockFetchMaybeSingle).not.toHaveBeenCalled();
  });

  it("returns 503 when the service-role key isn't configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 500 and propagates the message on query error", async () => {
    mockFetchMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "transient pg outage" },
    });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("transient pg outage");
  });

  it("returns 404 when maybeSingle resolves with no row", async () => {
    mockFetchMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "evt_missing" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/webhooks/[id] — happy path", () => {
  it("returns 200 with the full row body", async () => {
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { row: { id: string; type: string } };
    expect(body.row.id).toBe("evt_abc");
    expect(body.row.type).toBe("customer.subscription.updated");
  });
});
