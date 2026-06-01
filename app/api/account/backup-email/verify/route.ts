import { hashBackupEmailCode } from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import { assertFreshAal2 } from "@/lib/auth/mfa-required";
import { reportServerError } from "@/lib/error-reporter";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/** Verify the OTP sent to a candidate backup email.
 *
 *  Body: `{ code }` — the 6-digit string the user typed.
 *
 *  On success: promote `backup_email_pending` → `backup_email`, set
 *  `backup_email_verified_at = now()`, and clear the OTP fields
 *  (hash, expires_at). Returns `{ ok: true, backupEmail }`.
 *
 *  On failure: 400 with a generic message. We deliberately don't
 *  distinguish "expired" from "wrong code" — both responses say
 *  "code didn't match or has expired" so an attacker probing for
 *  a valid code learns nothing about timing. */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  // Strict AAL2: completes the change-of-recovery-channel flow
  // started by /start. Same threat model — must not honor the
  // trusted-device escape hatch.
  const gate = await assertFreshAal2(supabase);
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { code } = parsed.data;

  // Rate limit OTP brute-force attempts. The OTP itself rotates
  // after a few wrong guesses (handled by the hash comparison
  // below), but unlimited attempts give an attacker the ability
  // to keep the request flow burning until they luck out — or
  // simply DOS the route. Per-user limit is tight because a
  // legitimate user types one or two codes max.
  const rateLimit = await checkAuthRateLimit({
    surface: "backup-email-verify",
    ip: ipFromRequest(req),
    target: user.id,
    ipLimit: 60, // shared NAT shouldn't block; many users may verify from one office
    targetLimit: 10, // 10 attempts per user per hour
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  type ProfileVerifyRow = {
    backup_email_pending: string | null;
    backup_email_code_hash: string | null;
    backup_email_code_expires_at: string | null;
  };
  const { data: profile, error: selErr } = await admin
    .from("profiles")
    .select(
      "backup_email_pending, backup_email_code_hash, backup_email_code_expires_at",
    )
    .eq("user_id", user.id)
    .maybeSingle<ProfileVerifyRow>();
  if (selErr) {
    await reportServerError(selErr, {
      route: "/api/account/backup-email/verify",
      context: { userId: user.id, step: "lookup" },
    });
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json(
      { error: "No verification in progress. Start over from Settings." },
      { status: 400 },
    );
  }

  const generic = NextResponse.json(
    { error: "Code didn't match or has expired. Send a new one." },
    { status: 400 },
  );
  if (
    !profile.backup_email_pending ||
    !profile.backup_email_code_hash ||
    !profile.backup_email_code_expires_at
  ) {
    return generic;
  }
  if (Date.parse(profile.backup_email_code_expires_at) < Date.now()) {
    return generic;
  }
  if (hashBackupEmailCode(code) !== profile.backup_email_code_hash) {
    return generic;
  }

  const verifiedAt = new Date().toISOString();
  const promoted = profile.backup_email_pending;
  const { error: updErr } = await admin
    .from("profiles")
    .update({
      backup_email: promoted,
      backup_email_verified_at: verifiedAt,
      backup_email_pending: null,
      backup_email_code_hash: null,
      backup_email_code_expires_at: null,
    })
    .eq("user_id", user.id);
  if (updErr) {
    await reportServerError(updErr, {
      route: "/api/account/backup-email/verify",
      context: { userId: user.id, step: "promote" },
    });
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, backupEmail: promoted, verifiedAt });
}
