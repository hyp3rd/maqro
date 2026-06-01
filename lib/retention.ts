/** Retention policy for operational tables.
 *
 *  Centralized here so the cron route, the tests, and any future
 *  admin-dashboard "retention status" panel all agree on the
 *  numbers. Each value is the number of days a row may live before
 *  the daily retention job is allowed to delete it.
 *
 *  Privacy policy commitments (see `app/privacy/page.tsx`):
 *    - error_log: 90 days. We claim this in section 4
 *      ("Operational error logs"). Changing it requires updating
 *      the policy too.
 *
 *  Operational commitments (see migration headers):
 *    - admin_audit_log: 2 years. The 0018 migration header
 *      mentions this as the target retention window.
 *    - stripe_webhook_events: 30 days. Idempotency only needs to
 *      cover Stripe's retry window (currently 3 days per Stripe
 *      docs), 30 gives generous headroom for forensics.
 *    - push_send_log: 90 days. Drives the admin Engagement tile
 *      (24h window) — 90 gives a 13-week longitudinal view if we
 *      ever build a CTR-over-time chart. At ~N daily-cron pushes ×
 *      M subscriptions per day, the row volume is bounded enough
 *      that a quarter of history is cheap.
 *    - push_event_log: 90 days. Mirrors push_send_log so the two
 *      can be joined / aggregated across the same window without
 *      "we have sends but no clicks" anomalies at the cutoff
 *      boundary.
 *
 *  ai_usage_monthly is NOT retained-out — it's tiny per-user-per-
 *  month aggregate data and disappears with the user on
 *  delete-account cascade.
 *
 *    - mfa_trusted_devices: 14 days. Trust windows themselves are
 *      7 days (set in `/api/auth/mfa/trusted-devices` POST), so 14
 *      gives one full extra window of headroom before the cron
 *      sweeps a row out — useful in case the user comes back and
 *      hits a "this device was trusted last week" UI affordance.
 *      Anchor column is `trusted_until`, not `created_at`.
 *    - trace_events: 90 days. The admin "trace this user" flag
 *      is a debugging affordance; we don't need infinite history.
 *      Matches error_log so a joined query across both stays in
 *      the same window. */
export const RETENTION_DAYS = {
  error_log: 90,
  admin_audit_log: 365 * 2,
  stripe_webhook_events: 30,
  push_send_log: 90,
  push_event_log: 90,
  mfa_trusted_devices: 14,
  trace_events: 90,
} as const;

export type RetentionTable = keyof typeof RETENTION_DAYS;

/** Column the retention sweep compares `cutoff` against. Default is
 *  `created_at` (a convention every other table follows); overridden
 *  only for tables whose timestamp column has a different name.
 *
 *  `push_send_log` uses `sent_at` because the row records the moment
 *  the push was actually dispatched, which differs by ~ms from row-
 *  creation but is the semantically correct anchor — naming the
 *  column `sent_at` makes that intent visible in queries (e.g.
 *  "show me pushes sent in the last hour"). */
export const RETENTION_TIME_COLUMN: Partial<Record<RetentionTable, string>> = {
  push_send_log: "sent_at",
  // Trust windows are bounded by `trusted_until`, not by row age.
  // A row created 6 days ago with a 30-day trust is STILL valid;
  // sweeping by `created_at` would prematurely drop active trusts.
  mfa_trusted_devices: "trusted_until",
};

/** Column name used by the retention sweep for a given table. */
export function retentionTimeColumn(table: RetentionTable): string {
  return RETENTION_TIME_COLUMN[table] ?? "created_at";
}

/** ISO timestamp at which rows in `table` become eligible for
 *  deletion. Anything with `<retentionTimeColumn(table)> < this` is
 *  in scope. */
export function retentionCutoff(
  table: RetentionTable,
  now: Date = new Date(),
): string {
  const days = RETENTION_DAYS[table];
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000);
  return cutoff.toISOString();
}
