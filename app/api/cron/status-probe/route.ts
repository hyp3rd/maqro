import { assertCronSecret } from "@/lib/auth/cron-secret";
import { runAllChecks } from "@/lib/health/checks";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — public status-page probe.
 *
 *  Every 5 minutes (see `vercel.json`), this:
 *
 *    1. Runs the dependency checks in-process via
 *       `runAllChecks()` from `lib/health/checks.ts`. Previously
 *       the cron HTTP-fetched its own `/api/health` endpoint;
 *       every URL-resolution / Vercel-deployment-protection /
 *       JSON-parse failure on that round-trip masked as a false
 *       outage (the bug that fully red-coloured the freshly
 *       deployed `/status` page). The check helpers live in their
 *       own module so this code path and `/api/health` share one
 *       source of truth.
 *
 *    2. Writes one row to `public.status_probes` (migration 0043).
 *
 *    3. Prunes rows older than the 90-day retention window. Doing
 *       it inline saves a second cron entry; the per-tick cost is
 *       a single DELETE bounded by an index lookup.
 *
 *  Auth: Vercel cron supplies `Authorization: Bearer ${CRON_SECRET}`.
 *  Anything without a matching secret is rejected — the endpoint
 *  writes to the DB, so it can't be left open.
 *
 *  Trade-off: see `lib/health/checks.ts` docstring. We've
 *  deliberately given up the "what an external user sees" probe
 *  semantic; pair this with an external uptime monitor pointed at
 *  `/api/health` if that signal matters. */

export const runtime = "nodejs";

const RETENTION_DAYS = 90;

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

  // In-process probe. The recorded `response_ms` is the wall-clock
  // duration of the dependency checks (Supabase + Stripe in
  // parallel); that's still a useful signal — sustained latency
  // creep against either dep is exactly what a status page should
  // surface. `http_status` is derived (200 / 503) to match the
  // semantic /api/health would have returned for the same snapshot.
  const start = Date.now();
  const snapshot = await runAllChecks();
  const elapsed = Date.now() - start;

  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: insErr } = await admin
    .from("status_probes")
    .insert({
      overall_ok: snapshot.ok,
      supabase_status: snapshot.checks.supabase,
      stripe_status: snapshot.checks.stripe,
      upstash_status: snapshot.checks.upstash,
      response_ms: elapsed,
      http_status: snapshot.ok ? 200 : 503,
      app_version: snapshot.version,
    });
  if (insErr) {
    // The cron failure is operationally invisible without this log —
    // surface it so the maintainer can correlate a gap in the chart
    // with the underlying insert problem.
    console.error("[status-probe] insert failed:", insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Retention prune. Inline to avoid a second cron entry; cheap
  // because the index on probed_at makes the WHERE-cutoff seek-only.
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error: delErr } = await admin
    .from("status_probes")
    .delete()
    .lt("probed_at", cutoff);
  if (delErr) {
    // Non-fatal: a failed prune just means the table grows for a
    // tick. Log and move on.
    console.warn("[status-probe] retention prune failed:", delErr.message);
  }

  return NextResponse.json({ ok: true, snapshot, elapsed });
}
