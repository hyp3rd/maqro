import { describe, expect, it } from "vitest";
import { formatEnvIssues, validateEnvFor } from "./env";

/** Helpers - these tests drive `validateEnvFor` with synthetic
 *  snapshots, so they don't have to monkey-patch `process.env`. */
function snapshot(
  overrides: Partial<Parameters<typeof validateEnvFor>[0]> = {},
): Parameters<typeof validateEnvFor>[0] {
  return { NODE_ENV: "development", ...overrides } as Parameters<
    typeof validateEnvFor
  >[0];
}

describe("validateEnvFor - format rules", () => {
  it("flags a STRIPE_SECRET_KEY that doesn't look like a Stripe key", () => {
    const issues = validateEnvFor(
      snapshot({ STRIPE_SECRET_KEY: "not-a-stripe-key" }),
    );
    expect(
      issues.find((i) => i.message.includes("STRIPE_SECRET_KEY")),
    ).toBeDefined();
  });

  it("accepts both sk_test_ and sk_live_ prefixes", () => {
    const test = validateEnvFor(
      snapshot({
        STRIPE_SECRET_KEY: "sk_test_abc",
        STRIPE_WEBHOOK_SECRET: "whsec_abc",
      }),
    );
    const live = validateEnvFor(
      snapshot({
        STRIPE_SECRET_KEY: "sk_live_xyz",
        STRIPE_WEBHOOK_SECRET: "whsec_xyz",
      }),
    );
    expect(
      test.find((i) => i.message.includes("STRIPE_SECRET_KEY")),
    ).toBeUndefined();
    expect(
      live.find((i) => i.message.includes("STRIPE_SECRET_KEY")),
    ).toBeUndefined();
  });

  it("flags STRIPE_WEBHOOK_SECRET without whsec_ prefix", () => {
    const issues = validateEnvFor(
      snapshot({
        STRIPE_SECRET_KEY: "sk_test_abc",
        STRIPE_WEBHOOK_SECRET: "wrong",
      }),
    );
    expect(issues.find((i) => i.message.includes("whsec_"))).toBeDefined();
  });

  it("flags NEXT_PUBLIC_APP_URL that isn't an absolute URL", () => {
    const issues = validateEnvFor(
      snapshot({ NEXT_PUBLIC_APP_URL: "maqro.app" }),
    );
    expect(
      issues.find((i) => i.message.includes("NEXT_PUBLIC_APP_URL")),
    ).toBeDefined();
  });

  it("accepts an http(s) NEXT_PUBLIC_APP_URL", () => {
    const issues = validateEnvFor(
      snapshot({ NEXT_PUBLIC_APP_URL: "https://maqro.app" }),
    );
    expect(
      issues.find((i) => i.message.includes("NEXT_PUBLIC_APP_URL")),
    ).toBeUndefined();
  });

  it("accepts EMAIL_FROM in both bare and named form", () => {
    expect(
      validateEnvFor(snapshot({ EMAIL_FROM: "noreply@maqro.app" })).find((i) =>
        i.message.includes("EMAIL_FROM"),
      ),
    ).toBeUndefined();
    expect(
      validateEnvFor(
        snapshot({ EMAIL_FROM: "Maqro <noreply@maqro.app>" }),
      ).find((i) => i.message.includes("EMAIL_FROM")),
    ).toBeUndefined();
  });

  it("flags a malformed EMAIL_FROM", () => {
    const issues = validateEnvFor(snapshot({ EMAIL_FROM: "not-an-email" }));
    expect(issues.find((i) => i.message.includes("EMAIL_FROM"))).toBeDefined();
  });

  it("flags a SHARE_BADGE_SECRET shorter than 32 characters", () => {
    const issues = validateEnvFor(snapshot({ SHARE_BADGE_SECRET: "short" }));
    expect(
      issues.find((i) => i.message.includes("SHARE_BADGE_SECRET")),
    ).toBeDefined();
  });

  it("accepts a SHARE_BADGE_SECRET that meets the length floor", () => {
    const issues = validateEnvFor(
      snapshot({ SHARE_BADGE_SECRET: "a".repeat(32) }),
    );
    expect(
      issues.find((i) => i.message.includes("SHARE_BADGE_SECRET")),
    ).toBeUndefined();
  });

  it("accepts VAPID_SUBJECT in mailto: form", () => {
    const issues = validateEnvFor(
      snapshot({
        VAPID_SUBJECT: "mailto:ops@maqro.app",
        VAPID_PRIVATE_KEY: "x",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "y",
      }),
    );
    expect(
      issues.find((i) => i.message.includes("VAPID_SUBJECT")),
    ).toBeUndefined();
  });

  it("flags a plain-text VAPID_SUBJECT", () => {
    const issues = validateEnvFor(
      snapshot({
        VAPID_SUBJECT: "ops@maqro.app",
        VAPID_PRIVATE_KEY: "x",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "y",
      }),
    );
    expect(
      issues.find((i) => i.message.includes("VAPID_SUBJECT")),
    ).toBeDefined();
  });
});

describe("validateEnvFor - coherence", () => {
  it("flags STRIPE_SECRET_KEY without STRIPE_WEBHOOK_SECRET", () => {
    const issues = validateEnvFor(
      snapshot({ STRIPE_SECRET_KEY: "sk_test_abc" }),
    );
    expect(
      issues.find((i) => i.message.includes("STRIPE_WEBHOOK_SECRET")),
    ).toBeDefined();
  });

  it("flags STRIPE_WEBHOOK_SECRET without STRIPE_SECRET_KEY", () => {
    const issues = validateEnvFor(
      snapshot({ STRIPE_WEBHOOK_SECRET: "whsec_abc" }),
    );
    expect(
      issues.find((i) => i.message.includes("STRIPE_SECRET_KEY")),
    ).toBeDefined();
  });

  it("flags partial VAPID config (1 of 3 set)", () => {
    const issues = validateEnvFor(snapshot({ VAPID_PRIVATE_KEY: "only-this" }));
    expect(issues.find((i) => i.message.includes("VAPID"))).toBeDefined();
  });

  it("flags partial VAPID config (2 of 3 set)", () => {
    const issues = validateEnvFor(
      snapshot({ VAPID_PRIVATE_KEY: "x", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "y" }),
    );
    expect(issues.find((i) => i.message.includes("VAPID"))).toBeDefined();
  });

  it("accepts all-3 or none-of-3 VAPID config", () => {
    const allThree = validateEnvFor(
      snapshot({
        VAPID_PRIVATE_KEY: "x",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "y",
        VAPID_SUBJECT: "mailto:ops@maqro.app",
      }),
    );
    const none = validateEnvFor(snapshot());
    expect(allThree.find((i) => i.message.includes("VAPID"))).toBeUndefined();
    expect(none.find((i) => i.message.includes("VAPID"))).toBeUndefined();
  });

  it("flags RESEND_API_KEY without EMAIL_FROM", () => {
    const issues = validateEnvFor(snapshot({ RESEND_API_KEY: "re_abc" }));
    expect(issues.find((i) => i.message.includes("EMAIL_FROM"))).toBeDefined();
  });
});

describe("validateEnvFor - production gates", () => {
  it("requires NEXT_PUBLIC_SUPABASE_URL in production", () => {
    const issues = validateEnvFor(snapshot({ NODE_ENV: "production" }));
    expect(
      issues.find((i) => i.message.includes("NEXT_PUBLIC_SUPABASE_URL")),
    ).toBeDefined();
  });

  it("requires a publishable key (new or legacy) in production", () => {
    const newKey = validateEnvFor(
      snapshot({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    );
    const legacyKey = validateEnvFor(
      snapshot({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ.x.y",
      }),
    );
    expect(
      newKey.find((i) => i.message.includes("PUBLISHABLE_KEY")),
    ).toBeUndefined();
    expect(
      legacyKey.find((i) => i.message.includes("PUBLISHABLE_KEY")),
    ).toBeUndefined();
  });

  it("warns (not errors) about missing CRON_SECRET in production", () => {
    const issues = validateEnvFor(
      snapshot({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    );
    const cronIssue = issues.find((i) => i.message.includes("CRON_SECRET"));
    expect(cronIssue).toBeDefined();
    expect(cronIssue?.severity).toBe("warn");
  });

  it("does not enforce production-only rules in development", () => {
    const issues = validateEnvFor(snapshot({ NODE_ENV: "development" }));
    expect(
      issues.find((i) => i.message.includes("Production deploys require")),
    ).toBeUndefined();
  });
});

describe("formatEnvIssues", () => {
  it("returns a positive line when there are no issues", () => {
    expect(formatEnvIssues([])).toBe("Env validation passed.");
  });

  it("labels errors and warnings distinctly", () => {
    const out = formatEnvIssues([
      { severity: "error", message: "boom" },
      { severity: "warn", message: "heads-up" },
    ]);
    expect(out).toContain("[ERROR]");
    expect(out).toContain("[warn]");
    expect(out).toContain("boom");
    expect(out).toContain("heads-up");
  });
});
