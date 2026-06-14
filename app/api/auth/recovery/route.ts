import { isLikelyEmail, maskEmail } from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import { getAppUrl } from "@/lib/app-url";
import { createRecoveryGrant } from "@/lib/auth/recovery-grant";
import { requireHumanDeep } from "@/lib/bot-protection";
import { sendEmail } from "@/lib/email/resend";
import { accountRecoveryEmail } from "@/lib/email/templates";
import { reportServerError } from "@/lib/error-reporter";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  primaryEmail: z.string(),
  backupEmail: z.string(),
});

/** Lost-email recovery dispatch.
 *
 *  Body: `{ primaryEmail, backupEmail }` - the user submits BOTH
 *  to gate the flow. Requiring both addresses (vs. just the
 *  primary) raises the bar for an attacker who only knows the
 *  primary: they'd also need to know which email the user picked
 *  as a backup, which isn't public anywhere in the app.
 *
 *  Flow:
 *    1. Look up the profile whose primary matches `primaryEmail`
 *       AND `backup_email = backupEmail` AND `backup_email_verified_at
 *       IS NOT NULL`.
 *    2. If no match → return 202 anyway (don't leak which half
 *       was wrong, or whether a backup is set at all).
 *    3. If match → call `admin.auth.admin.generateLink({ type:
 *       'magiclink', email: primaryEmail })` to mint a one-shot
 *       sign-in link tied to the PRIMARY auth.users row.
 *    4. Deliver the link to the BACKUP address via Resend.
 *    5. Always return 202.
 *
 *  Security posture:
 *    - Deep-analysis BotID - recovery is exactly the surface a
 *      credential-stuffing bot would target.
 *    - 202 for BOTH hit and miss, so the response BODY never reveals
 *      whether an account / verified backup exists. Response *timing*
 *      isn't fully constant (the hit path mints a link + grant + send),
 *      so it's a weak side channel; the per-primary / per-backup / per-IP
 *      rate limits below are the real throttle against probing.
 *    - The magic-link delivers to the BACKUP inbox, not to the
 *      attacker-controlled primary lookup. Even if an attacker
 *      guesses both addresses, the email still goes only to the
 *      legitimate backup mailbox.
 *    - Every recovery attempt - successful or not - gets a
 *      `reportServerError` audit entry so spikes show up in the
 *      admin error log. */
export async function POST(req: Request): Promise<NextResponse> {
  const bot = await requireHumanDeep();
  if (!bot.ok) return bot.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  if (
    !isLikelyEmail(parsed.data.primaryEmail) ||
    !isLikelyEmail(parsed.data.backupEmail)
  ) {
    return NextResponse.json(
      { error: "Both addresses are required." },
      { status: 400 },
    );
  }
  const primaryEmail = parsed.data.primaryEmail.trim().toLowerCase();
  const backupEmail = parsed.data.backupEmail.trim().toLowerCase();

  // Rate limit by IP + primary email. Tight per-email cap so an
  // attacker can't spam a victim's backup inbox with our
  // recovery codes (each one comes from us; we'd burn through
  // Resend quota AND damage our sender reputation). Per-IP cap
  // is generous because legitimate users may retry from a shared
  // network. The 429 response mirrors the same "accepted-looking"
  // shape used for hit/miss below so an attacker can't distinguish
  // "this email is being throttled" from "this email doesn't exist"
  // - except they'll see the 429 status, which is acceptable: the
  // existence of a throttle is fine to disclose, the validity of
  // an address is not.
  const primaryLimit = await checkAuthRateLimit({
    surface: "auth-recovery",
    ip: ipFromRequest(req),
    target: primaryEmail,
    ipLimit: 20, // shared NAT - 20 attempts per hour
    targetLimit: 3, // any one primary email: 3 attempts per hour
    windowSeconds: 3600,
  });
  if (!primaryLimit.allowed) {
    return NextResponse.json(
      { error: "Too many recovery attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(primaryLimit.retryAfterSeconds) },
      },
    );
  }
  // Secondary throttle keyed by the BACKUP address. Closes the
  // asymmetry where an attacker iterates many guessed primary
  // emails (or many IPs) all aimed at the same backup inbox: the
  // primary limit above is per-primary so it doesn't catch that
  // pattern, and the per-IP limit can be diluted across a
  // rotating pool. A separate counter on the backup destination
  // ensures the backup mailbox is never hit more than 3 times per
  // hour regardless of how many primary guesses were tried against
  // it. `ip: null` so the same IP isn't double-counted (the IP
  // already paid against the primary surface above). Distinct
  // `surface` namespace keeps the buckets independent.
  const backupLimit = await checkAuthRateLimit({
    surface: "auth-recovery-backup",
    ip: null,
    target: backupEmail,
    ipLimit: 0,
    targetLimit: 3,
    windowSeconds: 3600,
  });
  if (!backupLimit.allowed) {
    return NextResponse.json(
      { error: "Too many recovery attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(backupLimit.retryAfterSeconds) },
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

  // The 202 "request received" body intentionally doesn't reveal
  // success vs. miss. Mirror that response across every early
  // exit below so timing isn't a side channel either.
  const accepted = NextResponse.json(
    {
      ok: true,
      message:
        "If both addresses match an account with a verified backup, a sign-in link has been sent to the backup address.",
    },
    { status: 202 },
  );

  // Look up by backup_email + verified. Profiles allow service-role reads - RLS
  // doesn't apply here. A verified backup can legitimately be shared by more
  // than one account (a couple / family — see migration 0029), so we do NOT use
  // maybeSingle(): on >1 match PostgREST returns PGRST116 and we'd silently miss
  // for everyone sharing the address. Fetch the candidates and pick the one
  // whose primary (auth.users.email, which `profiles` doesn't store) matches.
  type ProfileRow = { user_id: string };
  const { data: candidates } = await admin
    .from("profiles")
    .select("user_id")
    .eq("backup_email", backupEmail)
    .not("backup_email_verified_at", "is", null)
    .limit(10)
    .returns<ProfileRow[]>();
  if (!candidates || candidates.length === 0) return accepted;

  let matchedUserId: string | null = null;
  let matchedEmail: string | null = null;
  for (const candidate of candidates) {
    const { data: userLookup, error: lookupErr } =
      await admin.auth.admin.getUserById(candidate.user_id);
    if (lookupErr || !userLookup?.user) {
      await reportServerError(lookupErr ?? new Error("user lookup empty"), {
        route: "/api/auth/recovery",
        context: { step: "user-lookup" },
      });
      continue;
    }
    if (
      userLookup.user.email &&
      userLookup.user.email.toLowerCase() === primaryEmail
    ) {
      matchedUserId = candidate.user_id;
      matchedEmail = userLookup.user.email;
      break;
    }
  }
  // No (primary, verified-backup) pair matched - silent miss.
  if (!matchedUserId || !matchedEmail) return accepted;

  // Mint the magic-link token. We DON'T use the Supabase-hosted `action_link`;
  // instead we route the `hashed_token` through the app's own `/auth/confirm`
  // handler (which verifies it, sets the session cookies reliably, then
  // redirects to `next`) so the user lands on the lost-authenticator step-down.
  const appUrl = getAppUrl();
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: matchedEmail,
      options: { redirectTo: `${appUrl}/recover` },
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    await reportServerError(
      linkErr ?? new Error("generateLink returned no hashed_token"),
      { route: "/api/auth/recovery", context: { step: "generate-link" } },
    );
    return accepted;
  }

  // Single-use grant proving the user reached the step-down via THIS link (sent
  // to the backup inbox) — without it, a bare AAL1 session could strip 2FA.
  // Fail closed: if the grant didn't persist, don't email a dead link.
  const recoveryToken = await createRecoveryGrant(
    admin,
    matchedUserId,
    Date.now(),
  );
  if (!recoveryToken) {
    await reportServerError(new Error("recovery grant did not persist"), {
      route: "/api/auth/recovery",
      context: { step: "grant" },
    });
    return accepted;
  }

  const next = `/recover?rt=${recoveryToken}`;
  const magicLink =
    `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}` +
    `&type=magiclink&next=${encodeURIComponent(next)}`;

  const template = accountRecoveryEmail({
    appUrl,
    magicLink,
    primaryEmailMasked: maskEmail(matchedEmail),
  });
  const sendResult = await sendEmail({
    to: backupEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  if ("ok" in sendResult && !sendResult.ok) {
    await reportServerError(new Error(sendResult.error), {
      route: "/api/auth/recovery",
      context: { step: "send" },
    });
  }

  return accepted;
}
