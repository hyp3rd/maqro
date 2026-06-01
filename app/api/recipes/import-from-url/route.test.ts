import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSupabaseServer,
  mockFetchRecipePage,
  mockParseRecipeJsonLd,
  mockRpc,
  mockIsHostAllowed,
  mockExtractRecipeWithAi,
  mockGetCurrentMonthUsage,
  mockIncrementAiUsage,
  mockLoadUserTier,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockFetchRecipePage: vi.fn() as ReturnType<typeof vi.fn>,
  mockParseRecipeJsonLd: vi.fn(),
  mockRpc: vi.fn(async () => ({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  })),
  mockIsHostAllowed: vi.fn() as ReturnType<typeof vi.fn>,
  mockExtractRecipeWithAi: vi.fn() as ReturnType<typeof vi.fn>,
  mockGetCurrentMonthUsage: vi.fn() as ReturnType<typeof vi.fn>,
  mockIncrementAiUsage: vi.fn() as ReturnType<typeof vi.fn>,
  mockLoadUserTier: vi.fn() as ReturnType<typeof vi.fn>,
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
vi.mock("@/lib/recipe-import/fetch", () => ({
  fetchRecipePage: mockFetchRecipePage,
}));
vi.mock("@/lib/recipe-import/jsonld", () => ({
  parseRecipeJsonLd: mockParseRecipeJsonLd,
}));
vi.mock("@/lib/recipe-import/host-allowlist", () => ({
  isHostAllowed: mockIsHostAllowed,
}));
vi.mock("@/lib/recipe-import/ai-extract", () => ({
  extractRecipeWithAi: mockExtractRecipeWithAi,
}));
vi.mock("@/lib/billing/usage", () => ({
  getCurrentMonthUsage: mockGetCurrentMonthUsage,
  incrementAiUsage: mockIncrementAiUsage,
  loadUserTier: mockLoadUserTier,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mockRpc })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/recipes/import-from-url", {
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
  mockFetchRecipePage.mockResolvedValue({
    ok: true,
    html: "<html>…</html>",
    finalUrl: "https://example.com/recipes/1",
  });
  mockParseRecipeJsonLd.mockReturnValue({
    name: "Bolognese",
    ingredients: ["500 g beef"],
    instructions: ["Brown the beef."],
  });
  mockRpc.mockResolvedValue({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  });
  // Default: open mode (no allowlist restriction). Tests that
  // exercise the restrict-mode rejection override per-call.
  mockIsHostAllowed.mockResolvedValue({ ok: true, mode: "open" });
  // Default: paid user — the import route is now Plus+ gated. Tests
  // that exercise the gate override to "free".
  mockLoadUserTier.mockResolvedValue("plus");
  // Defaults for the AI path. Specific tests override per-call.
  mockGetCurrentMonthUsage.mockResolvedValue({
    used: 1,
    cap: 50,
    tier: "plus",
    isPremium: true,
    subscriptionStatus: "active",
    currentPeriodEnd: null,
  });
  mockIncrementAiUsage.mockResolvedValue(undefined);
  mockExtractRecipeWithAi.mockResolvedValue({
    recipe: {
      name: "AI-extracted recipe",
      ingredients: ["1 cup flour", "2 eggs"],
      instructions: ["Mix dry.", "Add eggs.", "Bake at 180°C."],
      prepNotes: "Best with butter.",
    },
  });
});

describe("POST /api/recipes/import-from-url — guards", () => {
  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://x.com" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when there's no session", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://x.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-JSON body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing url", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 429 when the rate limit blocks", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 50, retry_after_seconds: 600 }],
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://x.com" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
  });

  it("returns 402 for free-tier users (Plus+ gate)", async () => {
    mockLoadUserTier.mockResolvedValueOnce("free");
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://example.com/recipe" }));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { kind?: string };
    expect(body.kind).toBe("premium-required");
    // Critical: free user never gets near the fetcher. Reduces the
    // SSRF attack surface to paid accounts.
    expect(mockFetchRecipePage).not.toHaveBeenCalled();
  });

  it("admits 'plus' and 'pro' tiers", async () => {
    for (const tier of ["plus", "pro"] as const) {
      mockLoadUserTier.mockResolvedValueOnce(tier);
      const { POST } = await loadRoute();
      const res = await POST(req({ url: "https://example.com/recipe" }));
      expect(res.status, `expected 200 for ${tier}`).toBe(200);
    }
  });
});

describe("POST /api/recipes/import-from-url — error paths", () => {
  it("returns 400 when fetchRecipePage rejects the URL", async () => {
    mockFetchRecipePage.mockResolvedValueOnce({
      ok: false,
      error: "Only http(s) URLs are supported.",
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "ftp://x" }));
    expect(res.status).toBe(400);
  });

  it("returns 502 when fetch hits an origin error (5xx)", async () => {
    mockFetchRecipePage.mockResolvedValueOnce({
      ok: false,
      error: "Origin responded 502",
      status: 502,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://x.com" }));
    expect(res.status).toBe(502);
  });

  it("returns 422 when JSON-LD doesn't include a Recipe block", async () => {
    mockParseRecipeJsonLd.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://x.com" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/recipe data/i);
  });

  it("returns 422 when the host is not on the admin allowlist", async () => {
    mockIsHostAllowed.mockResolvedValueOnce({
      ok: false,
      reason: "Hostname attacker.test is not on the recipe-import allowlist.",
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://attacker.test/x" }));
    expect(res.status).toBe(422);
    // Critical: fetch was NEVER attempted for a non-allowlisted host.
    expect(mockFetchRecipePage).not.toHaveBeenCalled();
  });
});

describe("POST /api/recipes/import-from-url — happy path", () => {
  it("returns the parsed recipe + source URL", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ url: "https://cooking.nytimes.com/recipes/1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      recipe: { name: string; ingredients: string[] };
      sourceUrl: string;
    };
    expect(body.ok).toBe(true);
    expect(body.recipe.name).toBe("Bolognese");
    expect(body.recipe.ingredients).toEqual(["500 g beef"]);
    expect(body.sourceUrl).toBe("https://example.com/recipes/1");
  });

  it("includes source: 'jsonld' when AI was not requested", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://example.com/recipe" }));
    const body = (await res.json()) as { source?: string };
    expect(body.source).toBe("jsonld");
  });
});

describe("POST /api/recipes/import-from-url — parseWithAi flag", () => {
  it("returns 402 when the user is over their AI usage cap", async () => {
    mockGetCurrentMonthUsage.mockResolvedValueOnce({
      used: 50,
      cap: 50,
      tier: "free",
      isPremium: false,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({ url: "https://example.com/recipe", parseWithAi: true }),
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { kind?: string };
    expect(body.kind).toBe("ai-cap-reached");
    expect(mockExtractRecipeWithAi).not.toHaveBeenCalled();
    expect(mockIncrementAiUsage).not.toHaveBeenCalled();
  });

  it("returns the AI-extracted recipe with source: 'ai' on success", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ url: "https://example.com/recipe", parseWithAi: true }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      recipe: { name: string; prepNotes?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("ai");
    expect(body.recipe.name).toBe("AI-extracted recipe");
    expect(body.recipe.prepNotes).toBe("Best with butter.");
    // AI succeeded → the debit lands.
    expect(mockIncrementAiUsage).toHaveBeenCalledTimes(1);
  });

  it("falls back to JSON-LD when AI extraction fails", async () => {
    // AI returns null (Anthropic config missing, malformed tool
    // input, transport error). The JSON-LD pass already found
    // something, so we return that instead of failing the whole
    // request — the user opted into AI but we don't punish them
    // for the AI being down.
    mockExtractRecipeWithAi.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(
      req({ url: "https://example.com/recipe", parseWithAi: true }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("jsonld");
    // Crucially: the AI extraction didn't return a recipe, so the
    // user's quota is NOT debited. They paid for AI, got JSON-LD
    // fallback — keep the credit.
    expect(mockIncrementAiUsage).not.toHaveBeenCalled();
  });

  it("returns 422 when BOTH AI and JSON-LD fail to extract anything", async () => {
    mockExtractRecipeWithAi.mockResolvedValueOnce(null);
    mockParseRecipeJsonLd.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(
      req({ url: "https://example.com/recipe", parseWithAi: true }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/with or without AI/i);
  });

  it("nudges the user to retry with AI when JSON-LD alone fails", async () => {
    // parseWithAi=false + no JSON-LD → 422 with a hint that AI
    // might recover. The phrasing matters — it's the only place
    // we surface the AI option to users on sites without markup.
    mockParseRecipeJsonLd.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ url: "https://example.com/recipe" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Parse with AI/i);
  });

  it("does not consume AI usage when parseWithAi is false", async () => {
    const { POST } = await loadRoute();
    await POST(req({ url: "https://example.com/recipe" }));
    expect(mockGetCurrentMonthUsage).not.toHaveBeenCalled();
    expect(mockIncrementAiUsage).not.toHaveBeenCalled();
    expect(mockExtractRecipeWithAi).not.toHaveBeenCalled();
  });
});
