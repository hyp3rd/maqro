import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for GET /api/billing/invoices — the customer's invoice
 *  history. Branches that matter: missing Stripe config (503),
 *  no Supabase session (401), no Stripe customer (return empty —
 *  NOT a 404; the UI uses this surface as the read-only history
 *  table and an empty list is the canonical no-state), and the
 *  pagination cursor pass-through. The draft filter is also
 *  asserted — drafts are Stripe internal state, not user-facing,
 *  and showing them would confuse the table. */

const {
  mockGetStripe,
  mockGetSupabaseServer,
  mockProfileMaybeSingle,
  mockInvoicesList,
} = vi.hoisted(() => ({
  mockGetStripe: vi.fn(() => ({}) as object | null),
  mockGetSupabaseServer: vi.fn(),
  mockProfileMaybeSingle: vi.fn(),
  mockInvoicesList: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(query = ""): Request {
  return new Request(`http://localhost/api/billing/invoices${query}`);
}

function buildInvoice(over: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    number: "MAQRO-0001",
    created: 1735689600,
    amount_paid: 999,
    currency: "usd",
    status: "paid",
    hosted_invoice_url: "https://stripe.com/inv/in_1",
    invoice_pdf: "https://stripe.com/inv/in_1.pdf",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStripe.mockReturnValue({ invoices: { list: mockInvoicesList } });
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
  mockInvoicesList.mockResolvedValue({
    data: [buildInvoice()],
    has_more: false,
  });
});

describe("GET /api/billing/invoices", () => {
  it("returns 503 when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(req());
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
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns an empty list (NOT 404) when the user has no Stripe customer", async () => {
    // The UI treats invoices as a "view" panel — even free-tier
    // users see it, just empty. Returning 404 would force every
    // caller to special-case the no-customer branch.
    mockProfileMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: unknown[];
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(body.rows).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(mockInvoicesList).not.toHaveBeenCalled();
  });

  it("returns the mapped row shape + pagination flags on the happy path", async () => {
    mockInvoicesList.mockResolvedValueOnce({
      data: [
        buildInvoice({ id: "in_a" }),
        buildInvoice({ id: "in_b", number: "MAQRO-0002" }),
      ],
      has_more: true,
    });
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string; number: string | null; status: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(body.rows.length).toBe(2);
    expect(body.rows[0]?.id).toBe("in_a");
    expect(body.rows[1]?.number).toBe("MAQRO-0002");
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("in_b");
  });

  it("filters out draft invoices", async () => {
    mockInvoicesList.mockResolvedValueOnce({
      data: [
        buildInvoice({ id: "in_paid", status: "paid" }),
        buildInvoice({ id: "in_draft", status: "draft" }),
      ],
      has_more: false,
    });
    const { GET } = await loadRoute();
    const res = await GET(req());
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows.length).toBe(1);
    expect(body.rows[0]?.id).toBe("in_paid");
  });

  it("passes the `cursor` query param as Stripe's `starting_after`", async () => {
    const { GET } = await loadRoute();
    await GET(req("?cursor=in_last"));
    expect(mockInvoicesList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", starting_after: "in_last" }),
    );
  });

  it("forwards an allowed `status` param to Stripe", async () => {
    const { GET } = await loadRoute();
    await GET(req("?status=paid"));
    expect(mockInvoicesList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", status: "paid" }),
    );
    const res = await GET(req("?status=paid"));
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("paid");
  });

  it("silently falls back to 'all' on an unknown `status` (no Stripe filter applied)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(req("?status=banana"));
    // Status `all` must NOT be forwarded to Stripe — it's our
    // sentinel for "no filter". A passthrough would make Stripe
    // 400 on an unknown enum.
    const callArgs = mockInvoicesList.mock.calls.at(-1)?.[0] as {
      status?: string;
    };
    expect(callArgs.status).toBeUndefined();
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("all");
  });

  it("clamps `limit` over the MAX (100) down to 100", async () => {
    const { GET } = await loadRoute();
    await GET(req("?limit=10000"));
    expect(mockInvoicesList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("coerces null hosted_invoice_url + invoice_pdf to null (not undefined)", async () => {
    mockInvoicesList.mockResolvedValueOnce({
      data: [
        buildInvoice({ hosted_invoice_url: null, invoice_pdf: undefined }),
      ],
      has_more: false,
    });
    const { GET } = await loadRoute();
    const res = await GET(req());
    const body = (await res.json()) as {
      rows: Array<{
        hostedInvoiceUrl: string | null;
        invoicePdf: string | null;
      }>;
    };
    expect(body.rows[0]?.hostedInvoiceUrl).toBeNull();
    expect(body.rows[0]?.invoicePdf).toBeNull();
  });
});
