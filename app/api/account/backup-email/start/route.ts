import {
  BACKUP_EMAIL_CODE_TTL_MS,
  generateBackupEmailCode,
  hashBackupEmailCode,
  isLikelyEmail,
  maskEmail,
} from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import { getAppUrl } from "@/lib/app-url";
import { assertFreshAal2 } from "@/lib/auth/mfa-required";
import { sendEmail } from "@/lib/email/resend";
import { backupEmailVerificationEmail } from "@/lib/email/templates";
import { reportServerError } from "@/lib/error-reporter";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/** Schema gates the email field to a string; the project-specific
 *  `isLikelyEmail` check (which is the source of truth for what
 *  Maqro accepts) stays inline because it returns a friendlier
 *  message than Zod's regex. */
const BodySchema = z.object({ email: z.string() });

/** Start a backup-email registration.
 *
 *  Body: `{ email }` — the candidate backup address.
 *
 *  Behavior:
 *    1. Auth-gated (cookie session).
 *    2. Reject when the candidate equals the primary email.
 *    3. Generate a 6-digit OTP, hash it, write to
 *       `profiles.backup_email_pending` + `backup_email_code_hash`
 *       + `backup_email_code_expires_at`. Any previously-pending
 *       state is overwritten — a fresh "send code" replaces the
 *       old code so a typo doesn't lock the user out.
 *    4. Send the raw OTP via Resend to the candidate address.
 *
 *  Returns 200 with `{ ok: true, masked }` so the UI can echo back
 *  the address ("Code sent to a•••@example.com") without storing
 *  the raw address on the client. */
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
  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  // Strict AAL2: setting a NEW recovery channel could let an
  // attacker reroute future account-recovery flows to their own
  // address. The trusted-device escape hatch doesn't apply here.
  const gate = await assertFreshAal2(supabase);
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  if (!isLikelyEmail(parsed.data.email)) {
    return NextResponse.json(
      { error: "Provide a valid email address." },
      { status: 400 },
    );
  }
  const candidate = parsed.data.email.trim().toLowerCase();
  if (candidate === user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Backup email can't be the same as your primary email." },
      { status: 400 },
    );
  }

  // Rate limit BEFORE the collision check + email send. Without
  // this, the route is a vector for: (a) enumerating which emails
  // are real Maqro users via the collision-check response, and
  // (b) spamming a target inbox with verification codes. Limits
  // here are intentionally tight — a legitimate user sets a
  // backup email maybe once a year.
  const rateLimit = await checkAuthRateLimit({
    surface: "backup-email-start",
    ip: ipFromRequest(req),
    target: candidate,
    ipLimit: 30, // generous per-IP — a shared NAT shouldn't get blocked
    targetLimit: 5, // 5 sends per hour to any one address
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
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

  // Block using another Maqro user's primary email as a backup.
  // Without this, Alice could verify Bob's primary (e.g., shared
  // family inbox), then later trigger /api/auth/recovery and have
  // a sign-in link to Alice's account delivered to Bob's inbox —
  // a clean takeover vector or, at minimum, a confusing footgun.
  //
  // The check goes through a SECURITY DEFINER function (migration
  // 0030) because `auth.users` isn't exposed via PostgREST. The
  // function returns a single boolean — no PII, no enumeration
  // beyond what an authenticated probe could do on other routes.
  const { data: taken, error: rpcErr } = await admin.rpc(
    "email_taken_by_other_user",
    { candidate, excluding_user: user.id },
  );
  if (rpcErr) {
    await reportServerError(rpcErr, {
      route: "/api/account/backup-email/start",
      context: { userId: user.id, step: "collision-check" },
    });
    return NextResponse.json(
      { error: "Couldn't validate that email. Try again." },
      { status: 500 },
    );
  }
  if (taken === true) {
    return NextResponse.json(
      {
        error:
          "That email is registered to another Maqro account. Use an address you control that isn't a Maqro primary.",
      },
      { status: 409 },
    );
  }

  const code = generateBackupEmailCode();
  const expiresAt = new Date(Date.now() + BACKUP_EMAIL_CODE_TTL_MS);

  const { error: updErr } = await admin
    .from("profiles")
    .update({
      backup_email_pending: candidate,
      backup_email_code_hash: hashBackupEmailCode(code),
      backup_email_code_expires_at: expiresAt.toISOString(),
    })
    .eq("user_id", user.id);
  if (updErr) {
    await reportServerError(updErr, {
      route: "/api/account/backup-email/start",
      context: { userId: user.id, step: "persist" },
    });
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Send the OTP. The user's primary email is masked in the body so
  // the recipient understands which Maqro account this code belongs
  // to without revealing the full primary address — relevant when
  // the backup inbox is a partner's or a personal-vs-work split.
  const template = backupEmailVerificationEmail({
    appUrl: getAppUrl(),
    code,
    primaryEmailMasked: maskEmail(user.email),
  });
  const sendResult = await sendEmail({
    to: candidate,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  // Resend skips are not user-actionable but we don't surface them
  // as success either — log so the maintainer notices a missing
  // RESEND_API_KEY in prod.
  if ("ok" in sendResult && !sendResult.ok) {
    await reportServerError(new Error(sendResult.error), {
      route: "/api/account/backup-email/start",
      context: { userId: user.id, step: "send" },
    });
    return NextResponse.json(
      { error: "Couldn't send the verification email. Try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    masked: maskEmail(candidate),
    expiresAt: expiresAt.toISOString(),
  });
}
