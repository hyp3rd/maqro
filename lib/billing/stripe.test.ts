import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  isLiveSubscription,
  isStripeResourceMissing,
  pickLiveSubscription,
} from "./stripe";

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
