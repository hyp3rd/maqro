import { beforeEach, describe, expect, it, vi } from "vitest";

/** POST /api/billing/checkout. The billing-integrity branches: the Stripe
 *  customer id must be persisted (a checked UPDATE of the profiles row)
 *  before any Checkout Session exists, a customer with a
 *  live subscription is sent to a plan change instead of a second
 *  subscription, and older open sessions are expired so two tabs can't
 *  both complete. */

const h = vi.hoisted(() => ({
  getStripe: vi.fn(),
  getSupabaseServer: vi.fn(),
  profileRead: vi.fn(),
  adminUpdate: vi.fn(),
  adminFilters: [] as Array<[string, string, unknown]>,
  customersCreate: vi.fn(),
  subsList: vi.fn(),
  sessionsList: vi.fn(),
  sessionsExpire: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/stripe")>()),
  getStripe: h.getStripe,
}));
vi.mock("@/lib/auth/mfa-required", () => ({
  assertAal2: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/auth/trusted-device", () => ({
  trustedDeviceOption: vi.fn(async () => ({})),
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: h.getSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "http://supabase.test",
    secretKey: "service-role",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      update: (patch: unknown) => {
        const builder = {
          eq: (col: string, val: unknown) => {
            h.adminFilters.push(["eq", col, val]);
            return builder;
          },
          is: (col: string, val: unknown) => {
            h.adminFilters.push(["is", col, val]);
            return builder;
          },
          select: () => h.adminUpdate(patch),
        };
        return builder;
      },
    }),
  }),
}));

const { POST } = await import("./route");

function checkoutRequest(body: unknown = { plan: "plus", interval: "month" }) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.adminFilters.length = 0;
  vi.stubEnv("STRIPE_PRICE_AI_PLUS_MONTHLY", "price_plus_m");
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
  h.getStripe.mockReturnValue({
    customers: { create: h.customersCreate },
    subscriptions: { list: h.subsList },
    checkout: {
      sessions: {
        list: h.sessionsList,
        expire: h.sessionsExpire,
        create: h.sessionsCreate,
      },
    },
  });
  h.getSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "user@example.test" } },
      })),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.profileRead }) }),
    }),
  });
  h.profileRead.mockResolvedValue({
    data: { stripe_customer_id: null },
    error: null,
  });
  h.adminUpdate.mockResolvedValue({
    data: [{ user_id: "user-1" }],
    error: null,
  });
  h.customersCreate.mockResolvedValue({ id: "cus_new" });
  h.subsList.mockResolvedValue({ data: [] });
  h.sessionsList.mockResolvedValue({ data: [] });
  h.sessionsExpire.mockResolvedValue({});
  h.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
});

describe("POST /api/billing/checkout — customer persistence", () => {
  it("stores a new customer with a checked UPDATE before creating the session", async () => {
    const res = await POST(checkoutRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(h.adminUpdate).toHaveBeenCalledWith({
      stripe_customer_id: "cus_new",
    });
    expect(h.adminFilters).toEqual([
      ["eq", "user_id", "user-1"],
      ["is", "stripe_customer_id", null],
    ]);
    expect(h.sessionsCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: "cus_new",
      client_reference_id: "user-1",
    });
  });

  it("refuses to open Checkout when the customer id can't be stored", async () => {
    h.adminUpdate.mockResolvedValue({
      data: null,
      error: { message: "statement timeout" },
    });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(503);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses before creating a Stripe customer when the account has no profiles row", async () => {
    // Until the profile first syncs (or migration 0074 creates the row at
    // sign-up) there is no row to store a customer on; creating one anyway
    // would orphan it on every retry.
    h.profileRead.mockResolvedValue({ data: null, error: null });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "profile_missing" });
    expect(h.customersCreate).not.toHaveBeenCalled();
    expect(h.adminUpdate).not.toHaveBeenCalled();
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses to open Checkout when the profiles row disappears before the link", async () => {
    h.adminUpdate.mockResolvedValue({ data: [], error: null });
    h.profileRead
      .mockResolvedValueOnce({
        data: { stripe_customer_id: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(503);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("uses the customer a concurrent request stored first", async () => {
    // Our conditional UPDATE matched nothing because another request linked
    // its customer in between; reuse that one instead of overwriting it.
    h.adminUpdate.mockResolvedValue({ data: [], error: null });
    h.profileRead
      .mockResolvedValueOnce({
        data: { stripe_customer_id: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { stripe_customer_id: "cus_first" },
        error: null,
      });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(200);
    expect(h.subsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_first" }),
    );
    expect(h.sessionsCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: "cus_first",
    });
  });

  it("returns 500 when the profile can't be read", async () => {
    h.profileRead.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(500);
    expect(h.customersCreate).not.toHaveBeenCalled();
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/checkout — one subscription per customer", () => {
  beforeEach(() => {
    h.profileRead.mockResolvedValue({
      data: { stripe_customer_id: "cus_1" },
      error: null,
    });
  });

  it.each(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"])(
    "sends a customer with a %s subscription to a plan change (409)",
    async (status) => {
      h.subsList.mockResolvedValue({ data: [{ id: "sub_1", status }] });

      const res = await POST(
        checkoutRequest({ plan: "pro", interval: "month" }),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "subscription_exists" });
      expect(h.sessionsCreate).not.toHaveBeenCalled();
      expect(h.customersCreate).not.toHaveBeenCalled();
    },
  );

  it("lets a customer whose subscriptions have all ended subscribe again", async () => {
    h.subsList.mockResolvedValue({
      data: [
        { id: "sub_2", status: "canceled" },
        { id: "sub_1", status: "incomplete_expired" },
      ],
    });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(200);
    expect(h.subsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", status: "all" }),
    );
    expect(h.sessionsCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: "cus_1",
    });
  });

  it("expires the customer's other open Checkout Sessions first", async () => {
    h.sessionsList.mockResolvedValue({
      data: [{ id: "cs_old_1" }, { id: "cs_old_2" }],
    });

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(200);
    expect(h.sessionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", status: "open" }),
    );
    expect(h.sessionsExpire).toHaveBeenCalledWith("cs_old_1");
    expect(h.sessionsExpire).toHaveBeenCalledWith("cs_old_2");
    const expireOrder = h.sessionsExpire.mock.invocationCallOrder[1] ?? 0;
    const createOrder = h.sessionsCreate.mock.invocationCallOrder[0] ?? 0;
    expect(expireOrder).toBeLessThan(createOrder);
  });

  it("does not open a new session when an older one can't be expired", async () => {
    h.sessionsList.mockResolvedValue({ data: [{ id: "cs_old" }] });
    h.sessionsExpire.mockRejectedValue(new Error("session is complete"));

    const res = await POST(checkoutRequest());

    expect(res.status).toBe(502);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });
});
