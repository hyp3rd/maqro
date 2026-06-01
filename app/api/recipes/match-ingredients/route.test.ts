import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSupabaseServer, mockLoadUserTier, mockRpc } = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockLoadUserTier: vi.fn() as ReturnType<typeof vi.fn>,
  mockRpc: vi.fn(async () => ({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_x",
  }),
}));
vi.mock("@/lib/billing/usage", () => ({ loadUserTier: mockLoadUserTier }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mockRpc })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/recipes/match-ingredients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      })),
    },
  });
  mockLoadUserTier.mockResolvedValue("plus");
  mockRpc.mockResolvedValue({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  });
});

describe("POST /api/recipes/match-ingredients — gates", () => {
  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: ["500 g chicken breast"] }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when there's no session", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: ["x"] }));
    expect(res.status).toBe(401);
  });

  it("returns 402 for free-tier users (Plus+ gate)", async () => {
    mockLoadUserTier.mockResolvedValueOnce("free");
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: ["500 g chicken breast"] }));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { kind?: string };
    expect(body.kind).toBe("premium-required");
  });

  it("returns 400 for non-array ingredients", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: "not-an-array" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when one ingredient isn't a string", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: ["a", 42, "b"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when over the 50-ingredient cap", async () => {
    const big = Array.from({ length: 51 }, (_, i) => `item ${i}`);
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: big }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when the rate limit blocks", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 120, retry_after_seconds: 300 }],
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: ["x"] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("300");
  });
});

describe("POST /api/recipes/match-ingredients — happy path", () => {
  it("returns matcher results in input order", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ ingredients: ["500 g chicken breast", "no such ingredient"] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ original: string }> };
    expect(body.results.length).toBe(2);
    expect(body.results[0]?.original).toBe("500 g chicken breast");
    expect(body.results[1]?.original).toBe("no such ingredient");
  });

  it("returns an empty results array for an empty input list", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ ingredients: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});
