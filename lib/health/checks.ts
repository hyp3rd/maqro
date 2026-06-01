import { getStripe } from "@/lib/billing/stripe";
import { SUPABASE_CONFIG } from "@/lib/supabase/env";
import { APP_VERSION } from "@/lib/version";
import { createClient } from "@supabase/supabase-js";

/** In-process dependency checks shared by `/api/health` (HTTP-
 *  facing) and `/api/cron/status-probe` (records the result to
 *  `status_probes` for `/status` to render).
 *
 *  Two surfaces, one source of truth: previously the cron HTTP-
 *  fetched `/api/health` to record its result, which added a long
 *  list of failure modes (URL resolution falling back to localhost,
 *  Vercel deployment-protection auth walls returning HTML, JSON
 *  parse failures, redirect loops via the proxy's cookie writer).
 *  Every one of them collapsed the recorded shape to
 *  `overall_ok=false / supabase=fail / stripe=fail` — the false-
 *  positive "Service degraded" state the user reported on a
 *  freshly deployed `/status` page.
 *
 *  Running the same probes in-process from the cron eliminates that
 *  whole class of bugs. The trade-off is real: we no longer
 *  exercise edge routing or middleware on each probe, so a deploy
 *  that's broken in a way that leaves the function able to reach
 *  Supabase but the public URL serving 500s won't show up here.
 *  The honest semantic of this signal is "can our serverless
 *  function reach its dependencies?" — load-bearing for the rest
 *  of the app's ability to serve requests, but not the same as
 *  "what an external user sees". Pair with an external uptime
 *  monitor (Better Uptime / UptimeRobot) pointed at /api/health
 *  for the missing layer; that's the right tool for the
 *  end-to-end probe job. */

export type CheckStatus = "ok" | "fail" | "skipped";

export type HealthSnapshot = {
  ok: boolean;
  version: string;
  time: string;
  checks: { supabase: CheckStatus; stripe: CheckStatus };
};

/** Verify Supabase is reachable. Uses the publishable (anon) key
 *  and an RLS-respecting `SELECT` against `profiles` — an empty
 *  result for an unauthenticated request is the expected, healthy
 *  response. Any thrown error or a non-null error in the result
 *  counts as failure. Returns `skipped` when Supabase isn't
 *  configured (local dev / preview without env vars). */
export async function checkSupabase(): Promise<CheckStatus> {
  if (!SUPABASE_CONFIG) return "skipped";
  try {
    const client = createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.publishableKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await client
      .from("profiles")
      .select("user_id", { head: true, count: "exact" })
      .limit(1);
    return error ? "fail" : "ok";
  } catch {
    return "fail";
  }
}

/** Verify Stripe is reachable. Lists one product — the cheapest
 *  authenticated endpoint that proves the API key works without
 *  side-effects. Stripe outages do happen and we want to surface
 *  them in the check body, but they do NOT take the overall app
 *  health to fail (existing users keep using the app fully;
 *  only new upgrades break). Returns `skipped` when Stripe isn't
 *  configured. */
export async function checkStripe(): Promise<CheckStatus> {
  const stripe = getStripe();
  if (!stripe) return "skipped";
  try {
    await stripe.products.list({ limit: 1 });
    return "ok";
  } catch {
    return "fail";
  }
}

/** Run every dependency check in parallel and roll the per-check
 *  results up into the same `HealthSnapshot` shape `/api/health`
 *  returns. Parallel matters: Supabase typically responds in
 *  ~30–80ms and Stripe in ~100–200ms; sequential would double
 *  the probe latency for no reason.
 *
 *  `ok` matches the pre-extraction /api/health semantic exactly:
 *  Supabase must be `'ok'` (not `'skipped'`) for the deployment to
 *  count as healthy. A preview deployment with no Supabase env
 *  vars set deliberately returns 503 so uptime monitors flag the
 *  guest-mode shell as not-fully-up. Stripe is non-critical at
 *  this level — its status surfaces in the snapshot for finer-
 *  grained dashboards but doesn't influence `ok`. */
export async function runAllChecks(): Promise<HealthSnapshot> {
  const [supabase, stripe] = await Promise.all([
    checkSupabase(),
    checkStripe(),
  ]);
  return {
    ok: supabase === "ok",
    version: APP_VERSION,
    time: new Date().toISOString(),
    checks: { supabase, stripe },
  };
}
