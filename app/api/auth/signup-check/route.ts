import { parseBody } from "@/lib/api/parse-body";
import { checkSignupEmail } from "@/lib/auth/signup-guard";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Loose-on-email because the downstream `checkSignupEmail` is the
 *  source of truth — it returns specific reason codes (`invalid-email`
 *  / `disposable-domain`) the client maps to UX, and replacing that
 *  with Zod's stricter `z.string().email()` would collapse the two
 *  reasons into a single field-error envelope and break the existing
 *  client copy. */
const BodySchema = z.object({ email: z.unknown().optional() });

/** Pre-flight gate the email-OTP signup runs through BEFORE calling
 *  Supabase's signInWithOtp. Composes two checks:
 *
 *    1. Cheap shape + disposable-domain block (synchronous).
 *    2. Per-IP + per-email rate limit (Supabase-backed throttle).
 *
 *  Returns one of:
 *    - 200 { ok: true } - proceed with the Supabase call
 *    - 400 { reason: "invalid-email" }
 *    - 422 { reason: "disposable-domain" }
 *    - 429 + Retry-After  - rate limited
 *
 *  Why pre-flight rather than wrapping the Supabase call: keeping
 *  signInWithOtp client-side preserves Supabase's PKCE flow + the
 *  cross-device-safe numeric OTP path. We just add a HEAD-style
 *  precheck the client awaits before it proceeds.
 *
 *  Not bypass-proof - a sophisticated attacker hitting Supabase
 *  directly skips this. The value is dropping the casual / bot
 *  traffic that goes through the UI, which is the bulk of what
 *  shows up in real signup logs. */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const result = checkSignupEmail(parsed.data.email);
  if (!result.allowed) {
    if (result.reason === "invalid-email") {
      return NextResponse.json(
        { error: "Enter a valid email address.", reason: "invalid-email" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Disposable email addresses aren't supported. Use an address you check regularly.",
        reason: "disposable-domain",
      },
      { status: 422 },
    );
  }

  // Per-IP + per-email throttle. IP cap is generous so a busy office /
  // shared NAT doesn't get blocked; the email cap is tighter because a
  // legitimate user signs up to ONE address. Both surface 429 + Retry-After
  // on the same path the client already handles for /auth/recovery.
  const rateLimit = await checkAuthRateLimit({
    surface: "auth-signup",
    ip: ipFromRequest(req),
    target: result.email,
    ipLimit: 10, // 10 distinct signups per IP per day - well above legit
    targetLimit: 3, // any single email: at most 3 OTP requests per day
    windowSeconds: 60 * 60 * 24,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many signup attempts. Try again later or contact support.",
        reason: "rate-limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  return NextResponse.json({ ok: true });
}
