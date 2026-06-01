import { getAppUrl } from "@/lib/app-url";
import { assertFreshAal2 } from "@/lib/auth/mfa-required";
import { sendEmail } from "@/lib/email/resend";
import { accountDeletedEmail } from "@/lib/email/templates";
import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { cascadeDeleteUser } from "@/lib/user-deletion";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Permanently deletes the calling user's account. The cascade
 *  itself (Stripe cancel → Storage cleanup → auth.users delete)
 *  lives in `lib/user-deletion.ts` so the admin-driven path runs
 *  through the same steps in the same order.
 *
 *  Auth: cookie-bound server client identifies *which* user is
 *  calling, so we can never delete someone else by accident.
 *  The shared cascade uses a service-role admin client to do the
 *  privileged work.
 *
 *  Note on bot protection: this route used to gate behind
 *  `requireHumanDeep()` on the rationale that account deletion is
 *  irrecoverable. Removed after seeing the same false-positive
 *  pattern documented in `lib/bot-protection.ts` (Arc browsers and
 *  PWA users misclassified, 403s in production). The auth check
 *  immediately below is the load-bearing filter — the route can
 *  only ever delete the cookie-session caller's own account, so
 *  bot abuse can't fan out across other users' data. Worst-case
 *  bot scenario: an attacker who has already compromised a session
 *  scripts a deletion of THAT account, which is no worse than what
 *  they could do manually with the same session. */
export async function POST(): Promise<NextResponse> {
  const cookieClient = await getSupabaseServer();
  if (!cookieClient) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await cookieClient.auth.getUser();
  if (userError || !user) {
    // Surface the Supabase-reported reason so a stale-session 401
    // doesn't look the same as a never-authenticated 401. Without
    // this, "Auth session missing!" / "JWT expired" / "Invalid
    // Refresh Token" all collapse into the same opaque message
    // and the user can't tell whether to refresh + retry or
    // re-sign-in.
    const reason = userError?.message ?? "Not authenticated.";
    return NextResponse.json({ error: reason }, { status: 401 });
  }
  // Strict AAL2 gate — irreversible operation. We deliberately
  // SKIP the trusted-device escape hatch here: a 7-day trust grant
  // is meant to spare the user a TOTP prompt on routine actions, not
  // permit account deletion from a temporarily-compromised browser.
  // The user must present their second factor fresh.
  const gate = await assertFreshAal2(cookieClient);
  if (!gate.ok) return gate.response;

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Account deletion is not configured on this deployment (SUPABASE_SECRET_KEY missing).",
      },
      { status: 503 },
    );
  }

  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Capture email BEFORE deletion — once `auth.users` is gone
  // there's no way to recover the address for the confirmation send.
  const userEmail = user.email ?? null;

  const result = await cascadeDeleteUser({
    userId: user.id,
    admin,
    callerRoute: "/api/delete-account",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Confirmation email. Best-effort, sent AFTER the destructive op
  // so a Resend outage can't block the deletion. The user's right
  // to be forgotten outranks our right to confirm it.
  if (userEmail) {
    const template = accountDeletedEmail({ appUrl: getAppUrl() });
    const sendResult = await sendEmail({
      to: userEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
    if ("ok" in sendResult && !sendResult.ok) {
      await reportServerError(new Error(sendResult.error), {
        route: "/api/delete-account",
        context: { userId: user.id, step: "confirmation-email" },
      });
    }
  }

  return new NextResponse(null, { status: 204 });
}
