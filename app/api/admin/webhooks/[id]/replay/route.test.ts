import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdmin,
  mockWriteAuditLog,
  mockReportServerError,
  mockGetStripe,
  mockGetSupabaseSecretConfig,
  mockDispatch,
  mockFetchMaybeSingle,
  mockUpdateEq,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockWriteAuditLog: vi.fn(async () => {}),
  mockReportServerError: vi.fn(async () => {}),
  // Cast to `object | null` so the "Stripe not configured" test
  // can override the mock to return null without TS pinning the
  // return type to a non-nullable shape.
  mockGetStripe: vi.fn(() => ({}) as object | null),
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockDispatch: vi.fn(),
  mockFetchMaybeSingle: vi.fn(),
  mockUpdateEq: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));

vi.mock("@/lib/billing/webhook-handlers", () => ({
  dispatchStripeEvent: mockDispatch,
}));

// Mock the BotID helper so `checkBotId()` never runs from inside
// the route. Otherwise BotID logs a "Possible misconfiguration"
// warning on every test hit (it can't see the challenge headers a
// real browser would attach). Tests that want to assert the bot-
// rejection path override the mock locally — see delete-account
// for the pattern.
vi.mock("@/lib/bot-protection", () => ({
  requireHumanDeep: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockFetchMaybeSingle }) }),
      update: () => ({ eq: mockUpdateEq }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockFetchMaybeSingle.mockResolvedValue({
    // Cast widens the inferred return type so subsequent
    // mockResolvedValueOnce calls can pass `payload: null` without
    // a TS error (otherwise `null` doesn't fit the narrow first-call
    // shape vitest pins down).
    data: {
      id: "evt_abc",
      type: "customer.subscription.updated",
      payload: {
        id: "evt_abc",
        type: "customer.subscription.updated",
      } as unknown,
    },
    error: null,
  });
  mockDispatch.mockResolvedValue({ status: "success" });
  mockUpdateEq.mockResolvedValue({ error: null });
});

describe("POST /api/admin/webhooks/[id]/replay — guards", () => {
  it("returns the guard response when caller is not admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_x" }),
    });
    expect(res).toBe(forbidden);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rejects ids that don't start with evt_", async () => {
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "wat" }),
    });
    expect(res.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 404 when the event is not found", async () => {
    mockFetchMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 when the row has no stored payload", async () => {
    mockFetchMaybeSingle.mockResolvedValueOnce({
      data: { id: "evt_old", type: "x", payload: null },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_old" }),
    });
    expect(res.status).toBe(422);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/webhooks/[id]/replay — happy path", () => {
  it("dispatches the stored payload and updates the row", async () => {
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("success");
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockUpdateEq).toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: "admin-1",
        action: "stripe_webhook_replay",
      }),
    );
  });

  it("reports + returns error when dispatcher fails", async () => {
    mockDispatch.mockResolvedValueOnce({
      status: "error",
      error: new Error("handler boom"),
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "evt_abc" }),
    });
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("error");
    expect(body.error).toBe("handler boom");
    expect(mockReportServerError).toHaveBeenCalled();
    // Even on error, the audit log still records what the operator attempted.
    expect(mockWriteAuditLog).toHaveBeenCalled();
  });
});
