import { describe, expect, it } from "vitest";
import { isLiveSubscriptionStatus } from "./subscription-status";

describe("isLiveSubscriptionStatus", () => {
  it("is false for a user who never subscribed", () => {
    expect(isLiveSubscriptionStatus(null)).toBe(false);
    expect(isLiveSubscriptionStatus(undefined)).toBe(false);
  });

  it("is false for terminal statuses and true for billing ones", () => {
    expect(isLiveSubscriptionStatus("canceled")).toBe(false);
    expect(isLiveSubscriptionStatus("incomplete_expired")).toBe(false);
    expect(isLiveSubscriptionStatus("trialing")).toBe(true);
    expect(isLiveSubscriptionStatus("past_due")).toBe(true);
  });
});
