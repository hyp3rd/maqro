import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for GET + PATCH /api/billing/subscription. The
 *  interesting branches are the no-Stripe / no-customer / no-sub
 *  cascade (each must return a sensible status for the UI to act
 *  on), the upcoming-invoice null path (cancel_at_period_end →
 *  skip the preview lookup entirely), and the PATCH action
 *  allowlist + the 409 for already-canceled subscriptions. */

const {
  mockGetStripe,
  mockGetSupabaseServer,
  mockProfileMaybeSingle,
  mockSubsList,
  mockInvoicePreview,
  mockSubsUpdate,
} = vi.hoisted(() => ({
  // Cast widens so override tests can pass `null` for the
  // "Stripe not configured" branch.
  mockGetStripe: vi.fn(() => ({}) as object | null),
  mockGetSupabaseServer: vi.fn(),
  mockProfileMaybeSingle: vi.fn(),
  mockSubsList: vi.fn(),
  mockInvoicePreview: vi.fn(),
  mockSubsUpdate: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function buildSub(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          current_period_end: 1735689600, // 2025-01-01
          price: { nickname: "Plus monthly" },
        },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStripe.mockReturnValue({
    subscriptions: { list: mockSubsList, update: mockSubsUpdate },
    invoices: { createPreview: mockInvoicePreview },
  });
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockProfileMaybeSingle }) }),
    }),
  });
  mockProfileMaybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" },
    error: null,
  });
  mockSubsList.mockResolvedValue({ data: [buildSub()] });
  mockInvoicePreview.mockResolvedValue({
    amount_due: 999,
    currency: "usd",
    next_payment_attempt: 1735776000,
  });
  mockSubsUpdate.mockImplementation(
    async (_id: string, params: { cancel_at_period_end: boolean }) =>
      buildSub({ cancel_at_period_end: params.cancel_at_period_end }),
  );
});

describe("GET /api/billing/subscription", () => {
  it("returns 503 when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mockProfileMaybeSingle }) }),
      }),
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when the user has no Stripe customer", async () => {
    mockProfileMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockSubsList).not.toHaveBeenCalled();
  });

  it("returns 404 when the customer has no subscription", async () => {
    mockSubsList.mockResolvedValueOnce({ data: [] });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns subscription + upcoming on the happy path (price nickname → planLabel)", async () => {
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subscription: {
        id: string;
        status: string;
        planLabel: string;
        cancelAtPeriodEnd: boolean;
      };
      upcoming: { amount: number; currency: string } | null;
    };
    expect(body.subscription.id).toBe("sub_1");
    expect(body.subscription.status).toBe("active");
    expect(body.subscription.planLabel).toBe("Plus monthly");
    expect(body.subscription.cancelAtPeriodEnd).toBe(false);
    expect(body.upcoming).not.toBeNull();
    expect(body.upcoming?.amount).toBe(999);
    expect(body.upcoming?.currency).toBe("usd");
  });

  it("falls back to formatted amount + interval when the price nickname is missing", async () => {
    // The original bug: the route was returning the raw
    // `price_xxx` id when nickname was null. Now we fall back to
    // a human-readable amount-plus-interval string. Product-name
    // would have been more editorial but expanding the product
    // hits Stripe's 4-level expand ceiling and 500s the route.
    mockSubsList.mockResolvedValueOnce({
      data: [
        buildSub({
          items: {
            data: [
              {
                current_period_end: 1735689600,
                price: {
                  id: "price_zzz",
                  nickname: null,
                  currency: "usd",
                  unit_amount: 999,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        }),
      ],
    });
    const { GET } = await loadRoute();
    const res = await GET();
    const body = (await res.json()) as { subscription: { planLabel: string } };
    // Intl.NumberFormat output depends on locale — assert the
    // shape rather than an exact string. Different test runners
    // (CI vs local) may format $9.99 vs US$9.99 etc.
    expect(body.subscription.planLabel).toMatch(/9\.99/);
    expect(body.subscription.planLabel).toMatch(/month/);
  });

  it("skips the upcoming preview when the subscription is pending cancel", async () => {
    mockSubsList.mockResolvedValueOnce({
      data: [buildSub({ cancel_at_period_end: true })],
    });
    const { GET } = await loadRoute();
    const res = await GET();
    const body = (await res.json()) as { upcoming: unknown };
    expect(body.upcoming).toBeNull();
    // No point in fetching an upcoming invoice — Stripe will
    // cancel at period end and there's no next charge.
    expect(mockInvoicePreview).not.toHaveBeenCalled();
  });

  it("treats 'no upcoming invoice' as null (not an error)", async () => {
    // Stripe throws when the subscription has no upcoming invoice
    // (e.g. trialing, mid-billing-cycle weirdness). Must not 500.
    mockInvoicePreview.mockRejectedValueOnce(
      new Error("invoice_upcoming_none"),
    );
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upcoming: unknown };
    expect(body.upcoming).toBeNull();
  });
});

describe("PATCH /api/billing/subscription", () => {
  function req(body: unknown): Request {
    return new Request("http://localhost/api/billing/subscription", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when the body is not JSON", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api/billing/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when action is not in the allowlist", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(req({ action: "delete" }));
    expect(res.status).toBe(400);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("cancels by setting cancel_at_period_end=true", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(req({ action: "cancel" }));
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    const body = (await res.json()) as {
      subscription: { cancelAtPeriodEnd: boolean };
    };
    expect(body.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it("resumes by setting cancel_at_period_end=false", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(req({ action: "resume" }));
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });

  it("returns 409 on an already-canceled subscription", async () => {
    // A status="canceled" sub can't be flipped back via update —
    // Stripe requires a brand-new Checkout Session. We surface
    // 409 so the client can route the user to /upgrade.
    mockSubsList.mockResolvedValueOnce({
      data: [buildSub({ status: "canceled" })],
    });
    const { PATCH } = await loadRoute();
    const res = await PATCH(req({ action: "resume" }));
    expect(res.status).toBe(409);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });
});
