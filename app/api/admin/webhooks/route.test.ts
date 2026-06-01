import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for GET /api/admin/webhooks — the Stripe-webhook list
 *  endpoint that powers `/admin/webhooks`. The interesting surface
 *  is the query-builder shape (chainable `.select().order().limit()`
 *  plus conditional `.eq()` / `.is()` / `.gte()`) and the param
 *  parsing (status allowlist, since-range map, limit clamp). We
 *  assert *which* chain methods get called rather than just the
 *  response, so a refactor that silently drops a filter would
 *  fail. */

type ChainResult = {
  data: unknown[] | null;
  count: number | null;
  error: { message: string } | null;
};

const { mockRequireAdmin, mockGetSupabaseSecretConfig, chain, chainResult } =
  vi.hoisted(() => {
    const chainResult: { current: ChainResult } = {
      current: { data: [], count: 0, error: null },
    };
    // Chainable + thenable. Every method returns `chain` so the
    // route's `query = query.eq(...)` style threads through.
    // `then` makes `await query` resolve to the configured result
    // — the underlying PostgREST builder is thenable for the same
    // reason.
    const chain: {
      select: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      // `range(from, to)` superseded `limit(n)` when the route
      // moved to page-style pagination. Kept `limit` declared
      // for back-compat in case other tests still assert it.
      range: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      is: ReturnType<typeof vi.fn>;
      gte: ReturnType<typeof vi.fn>;
      then: (
        resolve: (v: ChainResult) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise<unknown>;
    } = {
      select: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      then: (resolve, reject) =>
        Promise.resolve(chainResult.current).then(resolve, reject),
    };
    return {
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
      chain,
      chainResult,
    };
  });

vi.mock("@/lib/rbac", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => chain })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(query: string): Request {
  return new Request(`http://localhost/api/admin/webhooks?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  chainResult.current = { data: [], count: 0, error: null };
});

describe("GET /api/admin/webhooks — guards", () => {
  it("returns the guard response when caller is not admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { GET } = await loadRoute();
    const res = await GET(req(""));
    expect(res).toBe(forbidden);
    expect(chain.select).not.toHaveBeenCalled();
  });

  it("returns 503 when the service-role key isn't configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(req(""));
    expect(res.status).toBe(503);
  });

  it("returns 500 and propagates the message on query error", async () => {
    chainResult.current = {
      data: null,
      count: null,
      error: { message: "relation does not exist" },
    };
    const { GET } = await loadRoute();
    const res = await GET(req(""));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("relation does not exist");
  });
});

describe("GET /api/admin/webhooks — happy path + filters", () => {
  it("returns the default-param shape and applies the 7d window", async () => {
    chainResult.current = {
      data: [{ id: "evt_1", type: "customer.subscription.updated" }],
      count: 42,
      error: null,
    };
    const { GET } = await loadRoute();
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: unknown[];
      total: number;
      status: string;
      since: string;
      page: number;
      per: number;
    };
    expect(body).toMatchObject({
      total: 42,
      status: "all",
      since: "7d",
      page: 1,
      per: 25,
    });
    expect(body.rows.length).toBe(1);
    // Default since is `7d`, so a `.gte()` on created_at must fire.
    expect(chain.gte).toHaveBeenCalledTimes(1);
    expect(chain.gte.mock.calls[0]?.[0]).toBe("created_at");
    // No status filter on the default `all`.
    expect(chain.eq).not.toHaveBeenCalled();
    expect(chain.is).not.toHaveBeenCalled();
  });

  it("filters by status=success via .eq()", async () => {
    const { GET } = await loadRoute();
    await GET(req("status=success"));
    expect(chain.eq).toHaveBeenCalledWith("processing_status", "success");
    expect(chain.is).not.toHaveBeenCalled();
  });

  it("filters by status=error via .eq()", async () => {
    const { GET } = await loadRoute();
    await GET(req("status=error"));
    expect(chain.eq).toHaveBeenCalledWith("processing_status", "error");
  });

  it("filters by status=pending via .is(null)", async () => {
    const { GET } = await loadRoute();
    await GET(req("status=pending"));
    // `pending` is the NULL-match special case — `.eq()` would
    // never match because NULL ≠ NULL in SQL.
    expect(chain.is).toHaveBeenCalledWith("processing_status", null);
    expect(chain.eq).not.toHaveBeenCalled();
  });

  it("skips the .gte() window filter when since=all", async () => {
    const { GET } = await loadRoute();
    await GET(req("since=all"));
    expect(chain.gte).not.toHaveBeenCalled();
  });

  it("clamps `per` above MAX_PER (500) down to 500", async () => {
    const { GET } = await loadRoute();
    const res = await GET(req("per=10000"));
    const body = (await res.json()) as { per: number };
    expect(body.per).toBe(500);
    // Page 1 with per=500 means the SQL range is [0, 499].
    expect(chain.range).toHaveBeenCalledWith(0, 499);
  });

  it("rejects malformed status by treating it as 'all' (no filter)", async () => {
    // Allowlist behavior — anything not in {success,error,pending}
    // means no filter applied. The response still echoes the raw
    // value so the operator can see what they sent.
    const { GET } = await loadRoute();
    const res = await GET(req("status=hax"));
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("hax");
    expect(chain.eq).not.toHaveBeenCalled();
    expect(chain.is).not.toHaveBeenCalled();
  });
});
