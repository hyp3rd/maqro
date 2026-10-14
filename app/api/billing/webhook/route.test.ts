import { beforeEach, describe, expect, it, vi } from "vitest";

const constructEvent = vi.fn();
const dispatchStripeEvent = vi.fn();
const reportServerError = vi.fn();
const insert = vi.fn();
const statusUpdateEq = vi.fn();

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent } }),
}));
vi.mock("@/lib/billing/webhook-handlers", () => ({ dispatchStripeEvent }));
vi.mock("@/lib/error-reporter", () => ({ reportServerError }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "http://supabase.test",
    secretKey: "service-role",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({ insert, update: () => ({ eq: statusUpdateEq }) }),
  }),
}));

const { POST } = await import("./route");

const EVENT = { id: "evt_1", type: "customer.subscription.updated" };

function webhookRequest(): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=sig" },
    body: JSON.stringify(EVENT),
  });
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    constructEvent.mockReturnValue(EVENT);
    insert.mockResolvedValue({ error: null });
    statusUpdateEq.mockResolvedValue({ error: null });
    dispatchStripeEvent.mockResolvedValue({ status: "success" });
  });

  it("reports a failure to record the dispatch outcome", async () => {
    // Without the outcome the event row keeps processing_status NULL: it
    // shows neither as success nor as error, so a lost write would go
    // unnoticed.
    statusUpdateEq.mockResolvedValue({
      error: { message: "connection reset", code: "08006" },
    });

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(reportServerError.mock.calls[0]?.[1]).toMatchObject({
      route: "/api/billing/webhook",
      context: { event_id: "evt_1", step: "record-outcome" },
    });
  });

  it("records the outcome without reporting when everything lands", async () => {
    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it("reports a handler error and keeps it on the event row", async () => {
    dispatchStripeEvent.mockResolvedValue({
      status: "error",
      error: new Error("profiles update matched 0 rows"),
    });

    const res = await POST(webhookRequest());

    expect(await res.json()).toEqual({ received: true, handler_error: true });
    expect(reportServerError).toHaveBeenCalledTimes(1);
  });
});
