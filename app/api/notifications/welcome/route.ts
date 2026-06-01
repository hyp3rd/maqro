import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { sendEmail } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Send the one-time welcome email to a user who just opted in to
 *  email notifications. Idempotent: the route reads the caller's
 *  `notification_preferences.welcome_sent_at` first and returns
 *  early if it's already set. That makes the endpoint safe for
 *  the client to fire on every toggle-on without having to track
 *  "has the welcome been sent yet?" state itself.
 *
 *  The `welcome_sent_at` timestamp is set ONLY after a successful
 *  send. A failed send (Resend env missing, address rejected,
 *  network hiccup) leaves the column null so the next opt-in
 *  retries — without this, a single transient failure would
 *  permanently silence the welcome.
 *
 *  Auth: user-bound cookie client. The user can only ever trigger
 *  their own welcome — there's no cross-user surface here. */
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
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;
  if (!user.email) {
    return NextResponse.json(
      { error: "Account has no email address." },
      { status: 400 },
    );
  }

  // Per-user rate limit. The route is idempotent via `welcome_sent_at`
  // in the common case, but a flurry of concurrent calls (multiple
  // tabs flipping the toggle in the same second) can all read a null
  // `welcome_sent_at` and each fire a Resend send before the first
  // upsert lands. One welcome per user per hour caps that race AND
  // also bounds any future "toggle off then on" path that might
  // accidentally clear the flag.
  const rateLimit = await checkAuthRateLimit({
    surface: "welcome-email",
    ip: ipFromRequest(req),
    target: user.id,
    ipLimit: 10,
    targetLimit: 1,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many welcome requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // Idempotency check + flag read in a single query.
  const { data: prefs, error: readError } = await supabase
    .from("notification_preferences")
    .select("daily_reminder, weekly_recap, welcome_sent_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) {
    console.error("[welcome] prefs read failed:", readError);
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (prefs?.welcome_sent_at) {
    return NextResponse.json({ alreadySent: true });
  }
  const dailyReminder = prefs?.daily_reminder === true;
  const weeklyRecap = prefs?.weekly_recap === true;

  // Don't send welcome if neither flag is on — the user might have
  // hit the endpoint via a stale call after toggling everything off.
  // A welcome that says "you'll receive nothing" reads as broken.
  if (!dailyReminder && !weeklyRecap) {
    return NextResponse.json({
      skipped: true,
      reason: "No subscriptions active.",
    });
  }

  const appUrl = getAppUrl();

  const { subject, html, text } = welcomeEmail({
    appUrl,
    dailyReminder,
    weeklyRecap,
  });
  const result = await sendEmail({ to: user.email, subject, html, text });
  if ("ok" in result && result.ok) {
    // Mark sent. Use upsert because the prefs row exists (the
    // user just toggled a flag) but the call shape is identical
    // either way.
    const { error: updateError } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: user.id,
          daily_reminder: dailyReminder,
          weekly_recap: weeklyRecap,
          welcome_sent_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (updateError) {
      // Email sent but we couldn't record it — log loud. Next
      // toggle-on will send a duplicate welcome. Annoying but
      // recoverable.
      console.error(
        "[welcome] email sent but welcome_sent_at update failed:",
        updateError,
      );
    }
    return NextResponse.json({ ok: true });
  }
  if ("skipped" in result) {
    // Log skips too so the operator can tell "user-configured
    // welcome is firing but Resend env is missing" from "the
    // welcome isn't firing at all".
    console.warn(`[welcome] send skipped: ${result.reason}`);
    return NextResponse.json({ skipped: true, reason: result.reason });
  }
  // Resend returned a non-2xx OR fetch threw. Log the full error
  // (which already includes the Resend status code and body from
  // the sendEmail wrapper) so the operator can diagnose without
  // re-reading the source. Common cases:
  //   - 401 from Resend → RESEND_API_KEY wrong/missing
  //   - 403 → EMAIL_FROM domain not verified in Resend
  //   - 422 → free-tier "test mode" restriction (Resend only lets
  //     you send to your own verified address until you verify a
  //     sending domain)
  //   - network/timeout → outbound network from the function host
  console.error(`[welcome] send failed: ${result.error}`);
  return NextResponse.json({ error: result.error }, { status: 502 });
}
