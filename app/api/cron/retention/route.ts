import { assertCronSecret } from "@/lib/auth/cron-secret";
import { reportServerError } from "@/lib/error-reporter";
import {
  type RetentionTable,
  retentionCutoff,
  retentionTimeColumn,
} from "@/lib/retention";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Daily data-retention sweep.
 *
 *  Deletes rows older than the per-table retention window defined
 *  in [lib/retention.ts](../../../../lib/retention.ts):
 *
 *    - `error_log`            (90 days)   — keeps the privacy-policy
 *                                            promise honest
 *    - `admin_audit_log`      (2 years)   — long enough for SOC2-
 *                                            style audits, short
 *                                            enough that the table
 *                                            doesn't grow unbounded
 *    - `stripe_webhook_events` (30 days)  — idempotency only needs
 *                                            recent events; Stripe's
 *                                            retry window is ~3 days
 *    - `push_send_log`        (90 days)   — Engagement-tile source.
 *                                            Compared against `sent_at`,
 *                                            not `created_at`.
 *    - `push_event_log`       (90 days)   — Same window as the sends
 *                                            so admin aggregates have
 *                                            no boundary anomalies.
 *
 *  Schedule: daily at 04:00 UTC (lowest-traffic hour across our
 *  target time zones, see `vercel.json`).
 *
 *  Auth: same `CRON_SECRET` bearer header pattern as the other
 *  cron routes. Reject anything else with 401 so the route can't
 *  be abused as a "delete user data" lever. */
const TABLES: RetentionTable[] = [
  "error_log",
  "admin_audit_log",
  "stripe_webhook_events",
  "push_send_log",
  "push_event_log",
  "trace_events",
];

export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Run each table's sweep independently. A failure on one
  // shouldn't block the others — they're orthogonal data sets and
  // the cron will retry tomorrow.
  const results: Record<
    string,
    { cutoff: string; deleted: number; error?: string }
  > = {};
  for (const table of TABLES) {
    const cutoff = retentionCutoff(table);
    const column = retentionTimeColumn(table);
    try {
      // `select: 'minimal'` keeps the response payload small.
      // `count: 'exact'` requested via the header gives us back
      // the number of deleted rows for logging. The compared
      // column is per-table — most tables use `created_at`, but
      // `push_send_log` uses `sent_at`.
      const { count, error } = await admin
        .from(table)
        .delete({ count: "exact" })
        .lt(column, cutoff);
      if (error) {
        results[table] = { cutoff, deleted: 0, error: error.message };
        // Capture into the in-house error logger so the maintainer
        // sees it without having to scrape Vercel cron logs. The
        // route itself returns 200 to stop the retry loop — a
        // missed sweep recovers tomorrow.
        await reportServerError(error, {
          route: "/api/cron/retention",
          context: { table, cutoff, column },
        });
      } else {
        results[table] = { cutoff, deleted: count ?? 0 };
      }
    } catch (err) {
      results[table] = {
        cutoff,
        deleted: 0,
        error: err instanceof Error ? err.message : "unknown error",
      };
      await reportServerError(err, {
        route: "/api/cron/retention",
        context: { table, cutoff },
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
