import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchStripeEvent } from "./webhook-handlers";

/** The dispatcher itself is pure routing — the only thing it does
 *  is pick which handler to call and translate thrown errors into
 *  a typed outcome. We mock the Supabase + Stripe clients with the
 *  minimum surface each handler touches; deep handler behavior is
 *  out of scope (the live and replay routes both invoke the same
 *  dispatcher, so coverage here covers both).
 *
 *  The email-sending side-effects are mocked out and asserted via
 *  the `sendEmail` mock — we verify the right template fired with
 *  the right ingredients, not the actual SMTP transport. */

vi.mock("@/lib/email/resend", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, id: "msg-1" })),
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));

type EqArgs = [string, unknown];

/** Build a layered Supabase mock. Each `.from("profiles")` returns a
 *  fresh chain so test cases can assert per-call without bleed-over.
 *  `selectMaybeSingleResponse` lets a test override what the lookup
 *  returns (e.g. profile without a customer, profile with the
 *  cancellation stamp already set). */
function makeAdmin(
  selectMaybeSingleResponse: { data: unknown; error: unknown } = {
    data: {
      user_id: "user-1",
      cancellation_email_sent_at: null,
      subscription_confirmed_email_sent_at: null,
      payment_failed_email_sent_at: null,
      stripe_price_id: "price_pro_monthly",
    },
    error: null,
  },
) {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const maybeSingle = vi.fn().mockResolvedValue(selectMaybeSingleResponse);
  const selectEq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: selectEq });

  const from = vi.fn().mockReturnValue({ select, update });

  // Auth lookup: by default returns a user with an email so the
  // email-sending side-effect fires. Tests that care about the
  // no-email path override this.
  const getUserById = vi
    .fn()
    .mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      error: null,
    });
  const auth = { admin: { getUserById } };

  return {
    admin: { from, auth } as never,
    spies: {
      from,
      select,
      selectEq,
      maybeSingle,
      update,
      updateEq,
      getUserById,
    },
  };
}

function makeStripe() {
  const retrieve = vi
    .fn()
    .mockResolvedValue({
      id: "sub_123",
      status: "active",
      items: {
        data: [
          {
            current_period_end: 9999999999,
            price: {
              id: "price_pro_monthly",
              unit_amount: 1299,
              currency: "usd",
              recurring: { interval: "month" },
            },
          },
        ],
      },
    });
  return {
    stripe: { subscriptions: { retrieve } } as never,
    spies: { retrieve },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchStripeEvent", () => {
  it("returns success and no-ops on unknown event types", async () => {
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    const outcome = await dispatchStripeEvent(
      { type: "payment_intent.created", data: { object: {} } } as never,
      admin,
      stripe,
    );
    expect(outcome.status).toBe("success");
  });

  it("routes checkout.session.completed to the checkout handler", async () => {
    const { admin, spies } = makeAdmin();
    const { stripe, spies: stripeSpies } = makeStripe();
    const outcome = await dispatchStripeEvent(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            client_reference_id: "user-1",
            subscription: "sub_123",
            customer: "cus_abc",
            metadata: {},
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(outcome.status).toBe("success");
    expect(stripeSpies.retrieve).toHaveBeenCalledWith("sub_123");
    expect(spies.from).toHaveBeenCalledWith("profiles");
    expect(spies.update).toHaveBeenCalled();
  });

  it("routes customer.subscription.updated to the subscription handler", async () => {
    const { admin, spies } = makeAdmin();
    const { stripe } = makeStripe();
    const outcome = await dispatchStripeEvent(
      {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_abc",
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_end: 9999999999,
                  price: { id: "price_pro_monthly" },
                },
              ],
            },
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(outcome.status).toBe("success");
    const calledArgs = spies.selectEq.mock.calls[0] as unknown as EqArgs;
    expect(calledArgs[0]).toBe("stripe_customer_id");
    expect(calledArgs[1]).toBe("cus_abc");
  });

  it("returns an error outcome when the handler throws (missing profile)", async () => {
    const { admin } = makeAdmin({ data: null, error: null });
    const { stripe } = makeStripe();

    const outcome = await dispatchStripeEvent(
      {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_x",
            status: "canceled",
            customer: "cus_orphan",
            cancel_at_period_end: false,
            items: { data: [] },
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.message).toMatch(/cus_orphan/);
    }
  });

  it("rejects checkout sessions missing the user reference", async () => {
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    const outcome = await dispatchStripeEvent(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_abc",
            mode: "subscription",
            client_reference_id: null,
            metadata: {},
            subscription: "sub_x",
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.message).toMatch(/client_reference_id/);
    }
  });
});

describe("subscription confirmation email", () => {
  it("sends on checkout.session.completed when entitled + no prior stamp", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            client_reference_id: "user-1",
            subscription: "sub_123",
            customer: "cus_abc",
            metadata: {},
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [call] = (sendEmail as ReturnType<typeof vi.fn>).mock.calls;
    expect((call?.[0] as { subject: string }).subject).toMatch(/Maqro/i);
  });

  it("skips when subscription_confirmed_email_sent_at is already set", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin({
      data: {
        user_id: "user-1",
        cancellation_email_sent_at: null,
        subscription_confirmed_email_sent_at: "2026-04-01T00:00:00Z",
        payment_failed_email_sent_at: null,
        stripe_price_id: "price_pro_monthly",
      },
      error: null,
    });
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            client_reference_id: "user-1",
            subscription: "sub_123",
            customer: "cus_abc",
            metadata: {},
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("cancellation email", () => {
  it("fires on cancel_at_period_end=true when stamp is null", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_abc",
            cancel_at_period_end: true,
            items: {
              data: [
                {
                  current_period_end: 9999999999,
                  price: { id: "price_pro_monthly" },
                },
              ],
            },
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [call] = (sendEmail as ReturnType<typeof vi.fn>).mock.calls;
    expect((call?.[0] as { subject: string }).subject).toMatch(/cancel/i);
  });

  it("skips when the cancellation stamp is already set (idempotent)", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin({
      data: {
        user_id: "user-1",
        cancellation_email_sent_at: "2026-04-01T00:00:00Z",
        subscription_confirmed_email_sent_at: "2026-01-01T00:00:00Z",
        payment_failed_email_sent_at: null,
        stripe_price_id: "price_pro_monthly",
      },
      error: null,
    });
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_abc",
            cancel_at_period_end: true,
            items: {
              data: [
                {
                  current_period_end: 9999999999,
                  price: { id: "price_pro_monthly" },
                },
              ],
            },
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not fire on a normal status update with cancel_at_period_end=false", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_abc",
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_end: 9999999999,
                  price: { id: "price_pro_monthly" },
                },
              ],
            },
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("payment-failed final email", () => {
  it("does not send while Stripe is still retrying (next_payment_attempt is set)", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_123",
            customer: "cus_abc",
            amount_due: 1299,
            currency: "usd",
            next_payment_attempt: 9999999999,
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends when Stripe gives up (next_payment_attempt is null)", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin();
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_456",
            customer: "cus_abc",
            amount_due: 1299,
            currency: "usd",
            next_payment_attempt: null,
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [call] = (sendEmail as ReturnType<typeof vi.fn>).mock.calls;
    expect((call?.[0] as { subject: string }).subject).toMatch(
      /action needed/i,
    );
  });

  it("skips when the stamp is already set (same dunning cycle)", async () => {
    const { sendEmail } = await import("@/lib/email/resend");
    const { admin } = makeAdmin({
      data: {
        user_id: "user-1",
        cancellation_email_sent_at: null,
        subscription_confirmed_email_sent_at: null,
        payment_failed_email_sent_at: "2026-04-01T00:00:00Z",
        stripe_price_id: "price_pro_monthly",
      },
      error: null,
    });
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_789",
            customer: "cus_abc",
            amount_due: 1299,
            currency: "usd",
            next_payment_attempt: null,
          },
        },
      } as never,
      admin,
      stripe,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("invoice.payment_succeeded — clears dunning stamp", () => {
  it("clears the stamp when the user was previously past-due", async () => {
    const { admin, spies } = makeAdmin({
      data: {
        user_id: "user-1",
        payment_failed_email_sent_at: "2026-04-01T00:00:00Z",
      },
      error: null,
    });
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_paid",
            customer: "cus_abc",
            amount_paid: 1299,
            currency: "usd",
          },
        },
      } as never,
      admin,
      stripe,
    );
    // The update call should set payment_failed_email_sent_at: null.
    const updatePayloads = spies.update.mock.calls.map(
      (call) => call[0] as Record<string, unknown>,
    );
    expect(
      updatePayloads.some((p) => p.payment_failed_email_sent_at === null),
    ).toBe(true);
  });

  it("no-ops when the stamp was already clear", async () => {
    const { admin, spies } = makeAdmin({
      data: { user_id: "user-1", payment_failed_email_sent_at: null },
      error: null,
    });
    const { stripe } = makeStripe();
    await dispatchStripeEvent(
      {
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_paid",
            customer: "cus_abc",
            amount_paid: 1299,
            currency: "usd",
          },
        },
      } as never,
      admin,
      stripe,
    );
    // Lookup ran, but no update should follow.
    expect(spies.update).not.toHaveBeenCalled();
  });
});
