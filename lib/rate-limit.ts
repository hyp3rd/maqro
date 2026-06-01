import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";

/** Server-side rate limiting for the abuse-prone auth surfaces.
 *  Backed by the `auth_throttle` table + `check_throttle()` SQL
 *  function (migration 0036).
 *
 *  Each route should compose TWO checks:
 *
 *    1. Per-IP — caps a single attacker hitting many victims.
 *    2. Per-target (email, user id, …) — caps many attackers
 *       hitting one victim, or one attacker spamming one victim's
 *       inbox.
 *
 *  Failing either check rejects the request with 429 + a
 *  `Retry-After` header. The header value comes from the function's
 *  own retry hint, so the client knows exactly when to back off.
 *
 *  The bucket key namespaces by purpose ("backup-email:start:ip:1.2.3.4")
 *  so the same IP can be in good standing for /recovery while still
 *  throttled for /backup-email — they're separate exposure surfaces. */

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function adminClient() {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Check (and increment, if allowed) the rate-limit bucket.
 *
 *  Fail-OPEN on infrastructure errors (no Supabase config, RPC
 *  throws, unexpected response shape). The alternative — fail-
 *  closed — would let a Supabase outage take auth offline; the
 *  conservative trade is to accept the request and rely on
 *  upstream Vercel firewall rules for catastrophic abuse
 *  scenarios. The fail-open is logged at the call site, not here,
 *  so the operator knows the throttle wasn't actually enforced. */
export async function checkRateLimit(opts: {
  bucket: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const admin = adminClient();
  if (!admin) return { allowed: true };
  try {
    const { data, error } = await admin.rpc("check_throttle", {
      p_bucket: opts.bucket,
      p_limit: opts.limit,
      p_window_seconds: opts.windowSeconds,
    });
    if (error || !data) return { allowed: true };
    // Supabase returns table-returning functions as an array.
    // Defensive: assume the function shape but don't crash if it
    // ever shifts.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return { allowed: true };
    const allowed = (row as { allowed?: boolean }).allowed === true;
    if (allowed) return { allowed: true };
    const retryAfterSeconds =
      Number((row as { retry_after_seconds?: number }).retry_after_seconds) ||
      60;
    return { allowed: false, retryAfterSeconds };
  } catch {
    return { allowed: true };
  }
}

/** Convenience: check IP + target buckets together. Returns the
 *  first failing bucket's retry-after, or `{ allowed: true }` if
 *  both pass.
 *
 *  Order matters: we check the IP bucket first because it's the
 *  cheaper signal to compute (the caller already has the request
 *  headers) and because a hostile IP should be blocked even when
 *  it targets different victims. Email/target check is run only
 *  if IP passed.
 *
 *  IP can be null in local dev (no proxy chain). When null, the
 *  IP check is skipped — there's no IP to throttle against.
 *  Production deploys always have x-forwarded-for so this only
 *  affects local. */
export async function checkAuthRateLimit(opts: {
  /** Short tag identifying the route — namespaces the buckets so
   *  e.g. /recovery and /backup-email/start don't share state. */
  surface: string;
  ip: string | null;
  /** Email or user id — whichever is the "thing being protected".
   *  Lowercase emails before passing; we don't lowercase here in
   *  case the caller wants case-sensitive bucketing for some
   *  future surface. */
  target: string | null;
  ipLimit: number;
  targetLimit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  // Dev bypass. Otherwise an admin iterating locally on the signup
  // flow (3 OTP attempts per email per day) gets locked out of
  // their own dev environment with no way to clear the throttle
  // short of a `DELETE FROM auth_throttle` against the DB.
  //
  // Narrowly check "development" (not `!== "production"`) so the
  // vitest run — which sets NODE_ENV to "test" — still exercises
  // the 429 branch. Production builds always have NODE_ENV
  // === "production"; only `npm run dev` ends up with "development".
  if (process.env.NODE_ENV === "development") return { allowed: true };
  // Loopback bypass — covers `next start` runs and any case where
  // the request reaches us from 127.0.0.1 / ::1 (typically only
  // local). External traffic in deployed environments comes through
  // a proxy and never carries a loopback x-forwarded-for.
  if (opts.ip && isLoopback(opts.ip)) return { allowed: true };
  if (opts.ip) {
    const ipResult = await checkRateLimit({
      bucket: `${opts.surface}:ip:${opts.ip}`,
      limit: opts.ipLimit,
      windowSeconds: opts.windowSeconds,
    });
    if (!ipResult.allowed) return ipResult;
  }
  if (opts.target) {
    const targetResult = await checkRateLimit({
      bucket: `${opts.surface}:target:${opts.target}`,
      limit: opts.targetLimit,
      windowSeconds: opts.windowSeconds,
    });
    if (!targetResult.allowed) return targetResult;
  }
  return { allowed: true };
}

/** True if `ip` is a loopback address (IPv4 127.0.0.0/8 or IPv6
 *  `::1`). Used to bypass the throttle for local-development
 *  traffic that bypasses the proxy chain. */
function isLoopback(ip: string): boolean {
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("127.")) return true;
  // Some proxies emit IPv4-mapped IPv6: `::ffff:127.0.0.1`.
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

/** Resolve the caller's IP from the proxy chain. Vercel +
 *  Cloudflare both set `x-forwarded-for`; the leftmost entry is
 *  the originating client. Returns null when unavailable
 *  (local dev, direct hits with no proxy). */
export function ipFromRequest(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}
