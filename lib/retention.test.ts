import { describe, expect, it } from "vitest";
import {
  RETENTION_DAYS,
  retentionCutoff,
  retentionTimeColumn,
} from "./retention";

describe("RETENTION_DAYS", () => {
  it("matches the privacy-policy promise for error_log", () => {
    // The /privacy page section 4 ("Operational error logs") says
    // "Logs are deleted after 90 days." If this constant changes,
    // the policy needs to change too — failing this test is the
    // forcing function.
    expect(RETENTION_DAYS.error_log).toBe(90);
  });

  it("matches the operational target for admin_audit_log", () => {
    // 2 years = 730 days. Migration 0018's header comment is the
    // canonical reference.
    expect(RETENTION_DAYS.admin_audit_log).toBe(730);
  });

  it("keeps webhook events long enough for Stripe's retry window", () => {
    // Stripe retries for ~3 days; 30 leaves an order-of-magnitude
    // buffer for late deliveries and forensic spot-checks.
    expect(RETENTION_DAYS.stripe_webhook_events).toBe(30);
  });

  it("keeps 90 days of push send + event history", () => {
    // 90 days is the same window as error_log — large enough for a
    // quarterly CTR / health review, small enough that the
    // high-volume daily-cron writes stay bounded.
    expect(RETENTION_DAYS.push_send_log).toBe(90);
    expect(RETENTION_DAYS.push_event_log).toBe(90);
  });
});

describe("retentionTimeColumn", () => {
  it("defaults to `created_at`", () => {
    expect(retentionTimeColumn("error_log")).toBe("created_at");
    expect(retentionTimeColumn("admin_audit_log")).toBe("created_at");
    expect(retentionTimeColumn("stripe_webhook_events")).toBe("created_at");
    expect(retentionTimeColumn("push_event_log")).toBe("created_at");
  });

  it("uses `sent_at` for push_send_log", () => {
    // push_send_log records dispatch time; the column name documents
    // the semantic. The retention cron's WHERE clause has to match
    // or the sweep silently no-ops.
    expect(retentionTimeColumn("push_send_log")).toBe("sent_at");
  });
});

describe("retentionCutoff", () => {
  const fixedNow = new Date("2026-05-19T12:00:00Z");

  it("returns an ISO timestamp 90 days before now for error_log", () => {
    const cutoff = retentionCutoff("error_log", fixedNow);
    expect(cutoff).toBe(new Date("2026-02-18T12:00:00Z").toISOString());
  });

  it("returns an ISO timestamp 730 days before now for audit log", () => {
    const cutoff = retentionCutoff("admin_audit_log", fixedNow);
    // 730 days back from 2026-05-19 lands on 2024-05-20 (leap-year-
    // adjusted; we don't hand-compute and trust the Date math).
    const expected = new Date(
      fixedNow.getTime() - 730 * 24 * 60 * 60_000,
    ).toISOString();
    expect(cutoff).toBe(expected);
  });

  it("returns an ISO timestamp 30 days before now for webhook events", () => {
    const cutoff = retentionCutoff("stripe_webhook_events", fixedNow);
    expect(cutoff).toBe(new Date("2026-04-19T12:00:00Z").toISOString());
  });

  it("uses Date.now() when no override is passed", () => {
    // Smoke-test the default-argument path. We can't assert an
    // exact value but we can assert the result is within a few
    // ms of "now minus 90 days".
    const before = Date.now();
    const cutoff = retentionCutoff("error_log");
    const after = Date.now();
    const parsed = new Date(cutoff).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 90 * 24 * 60 * 60_000 - 5);
    expect(parsed).toBeLessThanOrEqual(after - 90 * 24 * 60 * 60_000 + 5);
  });
});
