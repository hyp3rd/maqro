import { parseBody } from "@/lib/api/parse-body";
import { consumeRecoveryGrant } from "@/lib/auth/recovery-grant";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ rt: z.string().min(1).max(512) });

/** POST /api/account/mfa/recover-unenroll — remove the caller's verified TOTP
 *  factor as the final step of lost-authenticator recovery.
 *
 *  SECURITY: gated by BOTH an authenticated session (the recovery magic link
 *  signed the user in) AND a single-use recovery grant `rt` (proof they reached
 *  here via the link delivered to their backup inbox, not a plain email-OTP
 *  session). A bare AAL1 session is deliberately NOT sufficient — that would let
 *  email access alone strip two-step verification. This route does NOT use
 *  `assertAal2`: by definition the caller can't reach AAL2 (their authenticator
 *  is gone); the `rt` grant is the authorization instead. The delete uses the
 *  service-role admin client because an AAL1 session can't self-unenroll a
 *  verified factor. */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Recovery isn't available right now." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Your recovery session has expired. Request a new link." },
      { status: 401 },
    );
  }

  // Light rate limit (defense in depth on top of the single-use grant gate) so
  // a session can't flood grant guesses. Keyed by IP + user.
  const limit = await checkAuthRateLimit({
    surface: "mfa-recover-unenroll",
    ip: ipFromRequest(req),
    target: user.id,
    ipLimit: 30,
    targetLimit: 10,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      { error: "Recovery isn't available right now." },
      { status: 503 },
    );
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The grant is the authorization: it proves backup-inbox control and is
  // single-use. Without a valid one, refuse — a session alone is not enough.
  const authorized = await consumeRecoveryGrant(
    admin,
    user.id,
    parsed.data.rt,
    Date.now(),
  );
  if (!authorized) {
    return NextResponse.json(
      {
        error:
          "This recovery link is invalid or has expired. Request a new one.",
      },
      { status: 403 },
    );
  }

  // Remove every verified TOTP factor for this user (normally exactly one).
  const { data: factorsData, error: listErr } =
    await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (listErr) {
    return NextResponse.json(
      { error: "Couldn't reach your security settings. Try again." },
      { status: 502 },
    );
  }
  const verifiedTotp = (factorsData?.factors ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  for (const factor of verifiedTotp) {
    const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({
      userId: user.id,
      id: factor.id,
    });
    if (delErr) {
      return NextResponse.json(
        { error: "Couldn't remove your authenticator. Try again." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true, removed: verifiedTotp.length });
}
