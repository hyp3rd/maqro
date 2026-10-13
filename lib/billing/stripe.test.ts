import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLiveSubscription,
  isStripeResourceMissing,
  pickLiveSubscription,
  priceIdForPlan,
} from "./stripe";

describe("priceIdForPlan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps every plan + interval to its configured price", () => {
    vi.stubEnv("STRIPE_PRICE_AI_PLUS_MONTHLY", "price_plus_m");
    vi.stubEnv("STRIPE_PRICE_AI_PLUS_YEARLY", "price_plus_y");
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_pro_y");
    expect(priceIdForPlan("plus", "month")).toBe("price_plus_m");
    expect(priceIdForPlan("plus", "year")).toBe("price_plus_y");
    expect(priceIdForPlan("pro", "month")).toBe("price_pro_m");
    expect(priceIdForPlan("pro", "year")).toBe("price_pro_y");
  });

  it("returns null for an unconfigured price", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", undefined);
    expect(priceIdForPlan("pro", "year")).toBeNull();
  });
});

function sub(id: string, status: string): Stripe.Subscription {
  return { id, status } as Stripe.Subscription;
}

describe("isLiveSubscription", () => {
  it.each(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"])(
    "treats %s as live",
    (status) => {
      expect(isLiveSubscription(sub("sub_1", status))).toBe(true);
    },
  );

  it.each(["canceled", "incomplete_expired"])(
    "treats %s as terminal",
    (status) => {
      expect(isLiveSubscription(sub("sub_1", status))).toBe(false);
    },
  );
});

describe("pickLiveSubscription", () => {
  it("skips a newer canceled subscription and returns the live one", () => {
    expect(
      pickLiveSubscription([
        sub("sub_new", "canceled"),
        sub("sub_old", "active"),
      ])?.id,
    ).toBe("sub_old");
  });

  it("returns the newest live subscription when there are several", () => {
    expect(
      pickLiveSubscription([sub("sub_b", "trialing"), sub("sub_a", "active")])
        ?.id,
    ).toBe("sub_b");
  });

  it("returns null when nothing is live", () => {
    expect(
      pickLiveSubscription([
        sub("sub_a", "canceled"),
        sub("sub_b", "incomplete_expired"),
      ]),
    ).toBeNull();
    expect(pickLiveSubscription([])).toBeNull();
  });
});

describe("isStripeResourceMissing", () => {
  it("matches Stripe's resource_missing error", () => {
    expect(
      isStripeResourceMissing(
        new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such subscription: 'sub_gone'",
        }),
      ),
    ).toBe(true);
  });

  it("does not match other Stripe or non-Stripe errors", () => {
    expect(
      isStripeResourceMissing(
        new Stripe.errors.StripeAPIError({
          type: "api_error",
          message: "Something went wrong",
        }),
      ),
    ).toBe(false);
    expect(
      isStripeResourceMissing(
        Object.assign(new Error("x"), { code: "resource_missing" }),
      ),
    ).toBe(false);
  });
});
