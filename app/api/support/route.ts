import { isLikelyEmail } from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import { getSetting, SETTING_DEFAULTS, SETTING_KEYS } from "@/lib/app-settings";
import { getAppUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/resend";
import {
  supportRequestConfirmationEmail,
  supportRequestEmail,
} from "@/lib/email/templates";
import { reportServerError } from "@/lib/error-reporter";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Schema gates shape + length bounds for the public contact form.
 *  Min-length on the body (10 chars) is enforced inline because the
 *  copy ("Message must be 10–5000 characters.") references the
 *  runtime constants and is friendlier than Zod's default message. */
const BodySchema = z.object({
  subject: z.string(),
  body: z.string(),
  email: z.string().optional(),
});

/** Customer support contact form.
 *
 *  Body: `{ subject, body, email? }`. `email` is required when the
 *  caller doesn't have an authenticated session - without it we
 *  have no way to reply. For logged-in users we ignore the field
 *  and use their auth.users email (less spoof surface, plus the
 *  user might forget to type the address that's actually attached
 *  to their account).
 *
 *  Side-effects:
 *    1. Send the message to `SUPPORT_INBOX` with the user's
 *       address as Reply-To, so a one-click reply lands in the
 *       user's inbox.
 *    2. Send a confirmation receipt to the user so they know the
 *       form didn't drop the message into a void.
 *
 *  Security posture:
 *    - Rate-limited per-IP (20/hr) and per-target-email (5/hr).
 *      Both layers needed: per-IP caps a single spammer hitting many
 *      addresses; per-email caps targeted harassment ("fill so-and-
 *      so's support queue with garbage from many IPs").
 *    - NO BotID - the rate limit is the cap, and BotID's basic-tier
 *      classifier misflagged enough real users in prod that the
 *      gate cost more than it caught. Worst-case bot scenario here:
 *      spam in our support inbox, capped at 20/hr from any one IP.
 *    - No referrer / hidden honeypot fields. Real spammers fill
 *      those; real users don't. The rate limit is the meaningful
 *      defense. */
const MIN_BODY_LENGTH = 10;
const MAX_BODY_LENGTH = 5000;
const MAX_SUBJECT_LENGTH = 200;

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (
    body.subject.trim().length === 0 ||
    body.subject.length > MAX_SUBJECT_LENGTH
  ) {
    return NextResponse.json(
      { error: `Subject must be 1–${MAX_SUBJECT_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (
    body.body.trim().length < MIN_BODY_LENGTH ||
    body.body.length > MAX_BODY_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `Message must be ${MIN_BODY_LENGTH}–${MAX_BODY_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  // Resolve the user's email: prefer the auth session, fall back to
  // the typed `email` for anonymous users. We trust the session
  // email and reject obviously-malformed typed addresses, but we
  // don't do any verification beyond that - the confirmation send
  // itself is the deliverability check (a bogus email just bounces).
  const supabase = await getSupabaseServer();
  let userEmail: string | null = null;
  let authState: "logged-in" | "anonymous" = "anonymous";
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      userEmail = user.email;
      authState = "logged-in";
    }
  }
  if (!userEmail) {
    if (!isLikelyEmail(body.email)) {
      return NextResponse.json(
        { error: "Email is required when you're not signed in." },
        { status: 400 },
      );
    }
    userEmail = body.email.trim().toLowerCase();
  }

  // Rate limit AFTER we've resolved the email so the per-target
  // bucket actually targets the right inbox. Both layers compose to
  // throttle both broad-spectrum spam (per-IP) and focused
  // harassment (per-email).
  const rateLimit = await checkAuthRateLimit({
    surface: "support",
    ip: ipFromRequest(req),
    target: userEmail,
    ipLimit: 20,
    targetLimit: 5,
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

  const subject = body.subject.trim();
  const message = body.body.trim();
  const appUrl = getAppUrl();
  const receivedAt = new Date().toISOString();
  const userAgent = req.headers.get("user-agent");

  // Resolve the destination at request time so an admin's edit to
  // app_settings.support_inbox propagates within the 60s cache TTL
  // - no redeploy needed. Falls back to the compiled-in default if
  // the row is missing or Supabase is unreachable.
  const supportInbox = await getSetting(
    SETTING_KEYS.supportInbox,
    SETTING_DEFAULTS[SETTING_KEYS.supportInbox],
  );

  // Internal envelope to the support inbox. Reply-To set so a
  // responder doesn't need to copy the address out of the body.
  const internalTemplate = supportRequestEmail({
    appUrl,
    subject,
    body: message,
    fromEmail: userEmail,
    authState,
    userAgent,
    receivedAt,
  });
  const internalResult = await sendEmail({
    to: supportInbox,
    subject: internalTemplate.subject,
    html: internalTemplate.html,
    text: internalTemplate.text,
    replyTo: userEmail,
  });

  if ("ok" in internalResult && !internalResult.ok) {
    // The internal send is the one that matters - if it fails the
    // user's message is lost. Surface a 502 so the UI can prompt a
    // retry rather than silently swallowing the failure.
    await reportServerError(new Error(internalResult.error), {
      route: "/api/support",
      context: { step: "internal-send", authState },
    });
    return NextResponse.json(
      { error: "Couldn't deliver your message. Please try again." },
      { status: 502 },
    );
  }

  // Confirmation back to the user. Best-effort - a delivery failure
  // here doesn't undo the internal send (their message DID reach us),
  // so we just log and return success.
  const confirmTemplate = supportRequestConfirmationEmail({ appUrl, subject });
  const confirmResult = await sendEmail({
    to: userEmail,
    subject: confirmTemplate.subject,
    html: confirmTemplate.html,
    text: confirmTemplate.text,
  });
  if ("ok" in confirmResult && !confirmResult.ok) {
    await reportServerError(new Error(confirmResult.error), {
      route: "/api/support",
      context: { step: "confirmation-send" },
    });
  }

  return NextResponse.json({ ok: true });
}
