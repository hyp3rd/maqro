import { describe, expect, it } from "vitest";
import {
  accountDeletedEmail,
  paymentFailedFinalEmail,
  subscriptionCancelledEmail,
  subscriptionConfirmedEmail,
  supportRequestConfirmationEmail,
  supportRequestEmail,
  trialEndingEmail,
} from "./templates";

describe("trialEndingEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    trialEnd: new Date("2026-06-15T12:00:00Z"),
    tierLabel: "AI Plus",
    amountCents: 499,
    currency: "usd",
    portalUrl: "https://billing.stripe.com/p/session/xyz",
  };

  it("includes the tier label and trial end date in the subject", () => {
    const { subject } = trialEndingEmail(baseOpts);
    expect(subject).toContain("AI Plus");
    // Day-of-week varies by locale, but the date components are stable.
    expect(subject).toMatch(/June 15|15 June/);
  });

  it("formats the amount via Intl.NumberFormat", () => {
    const { html, text } = trialEndingEmail(baseOpts);
    // Locale-independent: every Intl currency rendering for USD 4.99
    // contains the digits "4.99" or "4,99" plus a USD symbol/code.
    expect(html).toMatch(/(\$|US\$|USD).*4[.,]99|4[.,]99.*(USD)/);
    expect(text).toMatch(/(\$|US\$|USD).*4[.,]99|4[.,]99.*(USD)/);
  });

  it("still includes the amount and currency for unrecognized codes", () => {
    // Node's Intl is lax about 3-letter currency codes and may
    // format with the code as a placeholder rather than throwing.
    // Either path is fine — we just need the amount and an
    // identifier in the output so the user can read it.
    const { html } = trialEndingEmail({ ...baseOpts, currency: "xyz" });
    expect(html).toMatch(/4[.,]99/);
    expect(html.toLowerCase()).toContain("xyz");
  });

  it("links the portal URL as the primary CTA", () => {
    const { html, text } = trialEndingEmail(baseOpts);
    expect(html).toContain(baseOpts.portalUrl);
    expect(text).toContain(baseOpts.portalUrl);
  });

  it("notes that this is a one-time transactional email", () => {
    const { html } = trialEndingEmail(baseOpts);
    expect(html).toContain("one-time transactional");
  });
});

describe("subscriptionConfirmedEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    tierLabel: "AI Plus",
    amountCents: 499,
    currency: "usd",
    intervalLabel: "month",
    settingsUrl: "https://maqro.app/app?view=settings",
  };

  it("puts the tier label in the subject", () => {
    expect(subscriptionConfirmedEmail(baseOpts).subject).toContain("AI Plus");
  });

  it("includes the amount + interval line for receipts", () => {
    const { html, text } = subscriptionConfirmedEmail(baseOpts);
    expect(html).toMatch(/4[.,]99/);
    expect(html).toContain("/ month");
    expect(text).toMatch(/4[.,]99/);
    expect(text).toContain("/ month");
  });

  it("links the settings URL for self-service management", () => {
    const { html, text } = subscriptionConfirmedEmail(baseOpts);
    expect(html).toContain(baseOpts.settingsUrl);
    expect(text).toContain(baseOpts.settingsUrl);
  });
});

describe("subscriptionCancelledEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    tierLabel: "Pro",
    accessUntil: new Date("2026-07-04T00:00:00Z"),
    settingsUrl: "https://maqro.app/app?view=settings",
  };

  it("makes the past-tense cancellation language unambiguous", () => {
    const { html, text } = subscriptionCancelledEmail(baseOpts);
    // The user needs to know the action took. "Cancelled" beats
    // ambiguous "Cancellation requested" wording.
    expect(html.toLowerCase()).toContain("cancel");
    expect(text.toLowerCase()).toContain("cancel");
  });

  it("includes the access-until date so the user knows their grace window", () => {
    const { html, text } = subscriptionCancelledEmail(baseOpts);
    expect(html).toMatch(/July 4|4 July/);
    expect(text).toMatch(/July 4|4 July/);
  });

  it("links the settings URL for resume / management", () => {
    const { html } = subscriptionCancelledEmail(baseOpts);
    expect(html).toContain(baseOpts.settingsUrl);
  });
});

describe("paymentFailedFinalEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    tierLabel: "AI Plus",
    amountCents: 1299,
    currency: "usd",
    settingsUrl: "https://maqro.app/app?view=settings",
  };

  it("flags action needed in the subject so it's not lost in inbox triage", () => {
    expect(paymentFailedFinalEmail(baseOpts).subject.toLowerCase()).toContain(
      "action needed",
    );
  });

  it("includes the failed amount so the user recognizes which subscription", () => {
    const { html, text } = paymentFailedFinalEmail(baseOpts);
    expect(html).toMatch(/12[.,]99/);
    expect(text).toMatch(/12[.,]99/);
  });

  it("links settings for payment-method update", () => {
    const { html, text } = paymentFailedFinalEmail(baseOpts);
    expect(html).toContain(baseOpts.settingsUrl);
    expect(text).toContain(baseOpts.settingsUrl);
  });
});

describe("accountDeletedEmail", () => {
  const baseOpts = { appUrl: "https://maqro.app" };

  it("confirms the destructive action took", () => {
    const { subject, html, text } = accountDeletedEmail(baseOpts);
    expect(subject.toLowerCase()).toContain("deleted");
    expect(html.toLowerCase()).toContain("deleted");
    expect(text.toLowerCase()).toContain("deleted");
  });

  it("mentions any active subscription was cancelled", () => {
    const { html, text } = accountDeletedEmail(baseOpts);
    expect(html.toLowerCase()).toContain("cancel");
    expect(text.toLowerCase()).toContain("cancel");
  });

  it("does not include a recovery link — there is nothing to recover", () => {
    const { html } = accountDeletedEmail(baseOpts);
    expect(html).not.toContain("/auth/recovery");
    expect(html).not.toContain("magiclink");
  });
});

describe("supportRequestEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    subject: "Can't log in on iOS",
    body: "After updating to 17.4 the login button does nothing.",
    fromEmail: "user@example.com",
    authState: "logged-in" as const,
    userAgent: "Mozilla/5.0 (iPhone)",
    receivedAt: "2026-05-23T10:00:00Z",
  };

  it("prefixes the subject so it's filterable in the support inbox", () => {
    expect(supportRequestEmail(baseOpts).subject).toMatch(/^\[Maqro support\]/);
  });

  it("includes the user's auth state + email in the envelope", () => {
    const { html, text } = supportRequestEmail(baseOpts);
    expect(html).toContain("user@example.com");
    expect(html).toContain("logged-in");
    expect(text).toContain("user@example.com");
    expect(text).toContain("logged-in");
  });

  it("escapes HTML in user-supplied subject and body", () => {
    // An attacker pasting `<script>` in their message can't break out
    // of the support-inbox rendering. The user-supplied content is
    // entity-encoded before it enters the HTML body.
    const { html } = supportRequestEmail({
      ...baseOpts,
      subject: "<script>alert(1)</script>",
      body: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("truncates a long user-agent so the envelope stays readable", () => {
    const longUa = "X".repeat(500);
    const { html } = supportRequestEmail({ ...baseOpts, userAgent: longUa });
    // Should contain a truncated chunk but not the full 500-char string.
    expect(html).not.toContain("X".repeat(500));
  });

  it("renders a placeholder when user-agent is null", () => {
    const { html, text } = supportRequestEmail({
      ...baseOpts,
      userAgent: null,
    });
    expect(html).toContain("—");
    expect(text).toContain("—");
  });
});

describe("supportRequestConfirmationEmail", () => {
  const baseOpts = {
    appUrl: "https://maqro.app",
    subject: "Can't log in on iOS",
  };

  it("includes the original subject so the user knows what we received", () => {
    const { html, text } = supportRequestConfirmationEmail(baseOpts);
    expect(html).toContain("Can&#39;t log in on iOS");
    expect(text).toContain("Can't log in on iOS");
  });

  it("sets expectation that a real person responds", () => {
    const { html } = supportRequestConfirmationEmail(baseOpts);
    expect(html.toLowerCase()).toContain("real person");
  });
});
