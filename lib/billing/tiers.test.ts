import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURES, resolveTier, tierAtLeast } from "./tiers";

// Stable env so STRIPE_PRICES lookups resolve to known constants
// across tests. Setting these in beforeEach instead of at module
// scope keeps the suite hermetic — no test bleed from one env to
// the next.
beforeEach(() => {
  process.env.STRIPE_PRICE_AI_PLUS_MONTHLY = "price_plus_m";
  process.env.STRIPE_PRICE_AI_PLUS_YEARLY = "price_plus_y";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveTier", () => {
  it("defaults to free when nothing is set", () => {
    expect(resolveTier({})).toBe("free");
  });

  it("admin role short-circuits to pro regardless of other signals", () => {
    expect(
      resolveTier({
        role: "admin",
        isPremium: false,
        subscriptionStatus: "canceled",
      }),
    ).toBe("pro");
  });

  it("active Pro price resolves to pro", () => {
    expect(
      resolveTier({
        stripePriceId: "price_pro_m",
        subscriptionStatus: "active",
      }),
    ).toBe("pro");
  });

  it("active Plus price resolves to plus", () => {
    expect(
      resolveTier({
        stripePriceId: "price_plus_m",
        subscriptionStatus: "active",
      }),
    ).toBe("plus");
  });

  it("yearly Plus price resolves to plus", () => {
    expect(
      resolveTier({
        stripePriceId: "price_plus_y",
        subscriptionStatus: "trialing",
      }),
    ).toBe("plus");
  });

  it("non-entitled subscription status ignores the price ID", () => {
    expect(
      resolveTier({
        stripePriceId: "price_pro_m",
        subscriptionStatus: "canceled",
      }),
    ).toBe("free");
  });

  it("trialing status counts as entitled", () => {
    expect(
      resolveTier({
        stripePriceId: "price_pro_m",
        subscriptionStatus: "trialing",
      }),
    ).toBe("pro");
  });

  it("past_due status counts as entitled (pragmatic grace)", () => {
    expect(
      resolveTier({
        stripePriceId: "price_plus_m",
        subscriptionStatus: "past_due",
      }),
    ).toBe("plus");
  });

  it("grandfathered users with an active grace period get pro", () => {
    expect(
      resolveTier({
        isGrandfathered: true,
        grandfatherUntil: "2099-01-01T00:00:00Z",
      }),
    ).toBe("pro");
  });

  it("grandfathered users past their grace period fall back to paid status", () => {
    expect(
      resolveTier({
        isGrandfathered: true,
        grandfatherUntil: "2000-01-01T00:00:00Z",
        stripePriceId: "price_plus_m",
        subscriptionStatus: "active",
      }),
    ).toBe("plus");
  });

  it("grandfathered users past their grace with no paid sub fall back to free", () => {
    expect(
      resolveTier({
        isGrandfathered: true,
        grandfatherUntil: "2000-01-01T00:00:00Z",
      }),
    ).toBe("free");
  });

  it("isPremium with no price ID stays at plus (legacy C1 customers)", () => {
    expect(resolveTier({ isPremium: true })).toBe("plus");
  });

  it("indefinite comp Pro grant resolves to pro", () => {
    expect(resolveTier({ compTier: "pro" })).toBe("pro");
  });

  it("comp Plus grant resolves to plus", () => {
    expect(resolveTier({ compTier: "plus" })).toBe("plus");
  });

  it("comp grant with a future expiry is honored", () => {
    expect(
      resolveTier({ compTier: "pro", compUntil: "2099-01-01T00:00:00Z" }),
    ).toBe("pro");
  });

  it("comp grant past its expiry is ignored", () => {
    expect(
      resolveTier({ compTier: "pro", compUntil: "2000-01-01T00:00:00Z" }),
    ).toBe("free");
  });

  it("comp grant never downgrades a higher paid tier (comp plus + paid pro = pro)", () => {
    expect(
      resolveTier({
        compTier: "plus",
        stripePriceId: "price_pro_m",
        subscriptionStatus: "active",
      }),
    ).toBe("pro");
  });

  it("comp grant raises above a lower paid tier (comp pro + paid plus = pro)", () => {
    expect(
      resolveTier({
        compTier: "pro",
        stripePriceId: "price_plus_m",
        subscriptionStatus: "active",
      }),
    ).toBe("pro");
  });

  it("unknown price ID with active status falls back to free", () => {
    expect(
      resolveTier({
        stripePriceId: "price_mystery",
        subscriptionStatus: "active",
      }),
    ).toBe("free");
  });
});

describe("tierAtLeast", () => {
  it("free is the floor", () => {
    expect(tierAtLeast("free", "free")).toBe(true);
    expect(tierAtLeast("free", "plus")).toBe(false);
    expect(tierAtLeast("free", "pro")).toBe(false);
  });

  it("plus covers free but not pro", () => {
    expect(tierAtLeast("plus", "free")).toBe(true);
    expect(tierAtLeast("plus", "plus")).toBe(true);
    expect(tierAtLeast("plus", "pro")).toBe(false);
  });

  it("pro covers everything", () => {
    expect(tierAtLeast("pro", "free")).toBe(true);
    expect(tierAtLeast("pro", "plus")).toBe(true);
    expect(tierAtLeast("pro", "pro")).toBe(true);
  });
});

describe("FEATURES", () => {
  it("sync is Pro-only", () => {
    expect(FEATURES.canSync("free")).toBe(false);
    expect(FEATURES.canSync("plus")).toBe(false);
    expect(FEATURES.canSync("pro")).toBe(true);
  });

  it("cloud export is Pro-only", () => {
    expect(FEATURES.canCloudExport("free")).toBe(false);
    expect(FEATURES.canCloudExport("plus")).toBe(false);
    expect(FEATURES.canCloudExport("pro")).toBe(true);
  });

  it("email subscriptions allowed for plus and pro", () => {
    expect(FEATURES.canSubscribeEmails("free")).toBe(false);
    expect(FEATURES.canSubscribeEmails("plus")).toBe(true);
    expect(FEATURES.canSubscribeEmails("pro")).toBe(true);
  });

  it("custom share slugs are Pro-only", () => {
    expect(FEATURES.canCustomShareSlugs("free")).toBe(false);
    expect(FEATURES.canCustomShareSlugs("plus")).toBe(false);
    expect(FEATURES.canCustomShareSlugs("pro")).toBe(true);
  });

  it("URL recipe import is Plus+ (shrinks the SSRF attack surface)", () => {
    // Pinning this explicitly because the gate is load-bearing for
    // SSRF defense — drifting it back to `free` would re-open the
    // attack surface the gate was added to close.
    expect(FEATURES.canImportFromUrl("free")).toBe(false);
    expect(FEATURES.canImportFromUrl("plus")).toBe(true);
    expect(FEATURES.canImportFromUrl("pro")).toBe(true);
  });
});
