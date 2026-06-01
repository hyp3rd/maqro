import { parseBody } from "@/lib/api/parse-body";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  step: z.number().int().min(0).max(63),
  action: z.enum(["enter", "skip", "finish"]),
});

/** POST /api/onboarding/events - bump the funnel counter for one
 *  wizard step transition. Anonymous (the wizard runs before any
 *  sign-in), best-effort (a network blip shouldn't break the user's
 *  onboarding), and aggregate-only - see migration 0042 for the
 *  privacy rationale. There is no user_id / IP / session token in
 *  the persisted row; only the (date, step, action) triple gets a
 *  counter increment.
 *
 *  Rate limit: per-IP, generous. A real wizard fires up to ~10
 *  events (5 step-enters + a skip/finish), and an operator's NAT
 *  might surface many distinct users from one egress IP. 200/hour
 *  is well above legit but throttles a bot spraying counters.
 *
 *  Response: 204 on success (no body - the caller is fire-and-forget).
 *  Validation / config errors return 400 / 503 with a JSON message
 *  for diagnosability, but the client ignores the body either way. */

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { step, action } = parsed.data;

  // Per-IP rate limit. No per-target (there is none - anonymous).
  // The limiter's `targetLimit` is still required by the helper so
  // we pass it as Infinity-equivalent (a number large enough to
  // never fire) and a null target to skip the target check.
  const rateLimit = await checkAuthRateLimit({
    surface: "onboarding",
    ip: ipFromRequest(req),
    target: null,
    ipLimit: 200, // 200 events per IP per hour
    targetLimit: Number.MAX_SAFE_INTEGER,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many events." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // Service-role client to call the SECURITY DEFINER RPC. The RPC
  // is the only sanctioned write path on `onboarding_step_counters`;
  // the table itself has RLS on with no policies.
  const config = getSupabaseSecretConfig();
  if (!config) {
    // Unconfigured deployment - accept silently with 204 so the
    // wizard doesn't error on local dev that hasn't wired Supabase.
    // The lost counter is operationally invisible.
    return new NextResponse(null, { status: 204 });
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.rpc("bump_onboarding_counter", {
    p_step: step,
    p_action: action,
  });
  if (error) {
    // Don't surface DB errors to anon callers (no useful client
    // recovery anyway). Log to stderr for the operator and return
    // a generic 500.
    console.error("[onboarding] counter bump failed:", error);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
