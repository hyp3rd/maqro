import { runAllChecks, type HealthSnapshot } from "@/lib/health/checks";
import { NextResponse } from "next/server";

/** Health-check endpoint for uptime monitors (Better Uptime,
 *  UptimeRobot, Vercel's deployment checks, etc.).
 *
 *  Semantics:
 *    - Returns HTTP 200 when the app can reach its critical
 *      dependencies. "Critical" here means Supabase — without the
 *      DB the app is broken even in guest mode (auth, sync, billing
 *      all degrade). Stripe is non-critical: a Stripe outage stops
 *      new upgrades, but existing users still use the app fully.
 *    - Returns HTTP 503 when Supabase is unreachable. Uptime
 *      monitors typically alert on non-2xx; 503 (vs 500) reads as
 *      "service is intentionally telling me it's down" rather than
 *      "crashed mid-request".
 *    - The JSON body has per-dependency `checks` regardless of
 *      status code, so a dashboard can show "Stripe degraded, app
 *      still up" without parsing log lines.
 *
 *  Auth: public. Uptime probes hit this without credentials, and the
 *  body intentionally exposes nothing sensitive — just liveness +
 *  the deployed version. We do NOT echo env values, customer counts,
 *  or queue depths; that's a separate authenticated `/api/admin/...`
 *  surface.
 *
 *  Caching: disabled. A cached health check defeats the purpose.
 *
 *  Implementation: the dependency-check helpers live in
 *  `lib/health/checks.ts` so the status-probe cron can call them
 *  in-process. Previously the cron HTTP-fetched this route and saw
 *  every URL-resolution / auth-wall / JSON-parse failure as a false
 *  outage. See that module's docstring for the trade-off. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthSnapshot>> {
  const snapshot = await runAllChecks();
  return NextResponse.json(snapshot, { status: snapshot.ok ? 200 : 503 });
}
