import { beforeEach, describe, expect, it, vi } from "vitest";

/** POST /api/billing/change-plan — a subscriber's upgrade / plan switch.
 *  It must change the existing subscription (a Billing Portal
 *  `subscription_update_confirm` deep link: Stripe shows the proration and
 *  collects any payment), never create a second one. */

const h = vi.hoisted(() => ({
  getStripe: vi.fn(),
  getSupabaseServer: vi.fn(),
  profileRead: vi.fn(),
  subsList: vi.fn(),
  portalCreate: vi.fn(),
  reportServerError: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/stripe")>()),
  getStripe: h.getStripe,
}));
vi.mock("@/lib/auth/mfa-required", () => ({
  assertAal2: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: h.reportServerError,
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: h.getSupabaseServer,
}));

const { POST } = await import("./route");

function changeRequest(body: unknown = { plan: "pro", interval: "month" }) {
  return new Request("http://localhost/api/billing/change-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    items: { data: [{ id: "si_1", price: { id: "price_plus_m" } }] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PRICE_AI_PLUS_MONTHLY", "price_plus_m");
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
  vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_pro_y");
  h.getStripe.mockReturnValue({
    subscriptions: { list: h.subsList },
    billingPortal: { sessions: { create: h.portalCreate } },
  });
  h.getSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.profileRead }) }),
    }),
  });
  h.profileRead.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" },
    error: null,
  });
  h.subsList.mockResolvedValue({ data: [subscription()] });
  h.portalCreate.mockResolvedValue({ url: "https://billing.stripe.test/p" });
});

describe("POST /api/billing/change-plan", () => {
  it("deep-links a Plus subscriber into confirming the switch to Pro on the same subscription", async () => {
    const res = await POST(changeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.test/p" });
    expect(h.portalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://maqro.app/app?view=settings",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: "sub_1",
          items: [{ id: "si_1", price: "price_pro_m", quantity: 1 }],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: "https://maqro.app/app?view=settings" },
        },
      },
    });
  });

  it("changes the live subscription even when a newer canceled one exists", async () => {
    h.subsList.mockResolvedValue({
      data: [
        subscription({ id: "sub_new", status: "canceled" }),
        subscription({ id: "sub_live", status: "trialing" }),
      ],
    });

    const res = await POST(changeRequest({ plan: "pro", interval: "year" }));

    expect(res.status).toBe(200);
    expect(
      h.portalCreate.mock.calls[0]?.[0].flow_data.subscription_update_confirm,
    ).toMatchObject({
      subscription: "sub_live",
      items: [{ id: "si_1", price: "price_pro_y", quantity: 1 }],
    });
  });

  it("returns 409 for the plan the subscription is already on", async () => {
    const res = await POST(changeRequest({ plan: "plus", interval: "month" }));

    expect(res.status).toBe(409);
    expect(h.portalCreate).not.toHaveBeenCalled();
  });

  it("returns 404 with code no_subscription when there is nothing live to change", async () => {
    h.subsList.mockResolvedValue({
      data: [subscription({ status: "canceled" })],
    });

    const res = await POST(changeRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no_subscription" });
    expect(h.portalCreate).not.toHaveBeenCalled();
  });

  it("returns 404 with code no_subscription when the user has no customer", async () => {
    h.profileRead.mockResolvedValue({
      data: { stripe_customer_id: null },
      error: null,
    });

    const res = await POST(changeRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no_subscription" });
    expect(h.subsList).not.toHaveBeenCalled();
  });

  it.each(["past_due", "unpaid", "paused", "incomplete"])(
    "asks a %s subscriber to settle payment first (409)",
    async (status) => {
      h.subsList.mockResolvedValue({ data: [subscription({ status })] });

      const res = await POST(changeRequest());

      expect(res.status).toBe(409);
      expect(h.portalCreate).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for an unknown plan", async () => {
    const res = await POST(changeRequest({ plan: "gold", interval: "month" }));

    expect(res.status).toBe(400);
  });

  it("reports and returns 502 when Stripe refuses the portal session", async () => {
    h.portalCreate.mockRejectedValue(
      new Error("This price is not available in the portal configuration"),
    );

    const res = await POST(changeRequest());

    expect(res.status).toBe(502);
    expect(h.reportServerError).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the profile can't be read", async () => {
    h.profileRead.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    const res = await POST(changeRequest());

    expect(res.status).toBe(500);
    expect(h.subsList).not.toHaveBeenCalled();
  });
});
