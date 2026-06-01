import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { getStripe, tierLabelFromPriceId } from "@/lib/billing/stripe";
import { sendEmail } from "@/lib/email/resend";
import { trialEndingEmail } from "@/lib/email/templates";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — "your trial ends tomorrow" nudge.
 *
 *  Schedule (see `vercel.json`): once daily. The window is the next
 *  24–48 hours so a daily fire always catches every trial exactly
 *  once before it converts. With the `trial_ending_email_sent_at`
 *  idempotency stamp, even if the schedule double-fires (Vercel cron
 *  has at-least-once semantics) the user only ever gets one mail per
 *  trial.
 *
 *  Why transactional, not opt-in: this is account-state communication
 *  (your card is about to be charged), not marketing. CAN-SPAM /
 *  GDPR carve-outs for transactional mail apply. Same legal bucket
 *  as Stripe's "your card was charged" receipt — sent regardless of
 *  `notification_preferences`.
 *
 *  Selection logic:
 *    1. Profiles with `subscription_status = 'trialing'`.
 *    2. `current_period_end` between now+24h and now+48h.
 *    3. `trial_ending_email_sent_at IS NULL` (idempotency).
 *    4. Has `stripe_subscription_id` AND `stripe_customer_id`
 *       (without both we can't fetch the price or build a portal
 *       URL — should always be true for a trialing subscription
 *       but cheap guard).
 *
 *  For each match: pull the live subscription from Stripe to get the
 *  authoritative price + currency, mint a portal session, send the
 *  email, stamp the column. */
export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 24-48h window. The +24 lower bound avoids same-day surprise
  // mails when a trial ends in <24h (the user is already actively
  // converting — too late to be useful). The +48 upper bound is the
  // cron cadence (daily) plus a small buffer so a slightly-late
  // cron fire doesn't miss anyone.
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: trialingRows, error: selectErr } = await admin
    .from("profiles")
    .select(
      "user_id, stripe_subscription_id, stripe_customer_id, stripe_price_id, current_period_end",
    )
    .eq("subscription_status", "trialing")
    .gte("current_period_end", windowStart.toISOString())
    .lt("current_period_end", windowEnd.toISOString())
    .is("trial_ending_email_sent_at", null)
    .not("stripe_subscription_id", "is", null)
    .not("stripe_customer_id", "is", null);

  if (selectErr) {
    console.error("[cron/trial-ending] profile read failed:", selectErr);
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }
  const candidates = trialingRows ?? [];
  if (candidates.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: 0 });
  }

  const appUrl = getAppUrl();
  const returnUrl = `${appUrl}/app?view=settings`;

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of candidates) {
    const userId = row.user_id as string;
    const customerId = row.stripe_customer_id as string;
    const subscriptionId = row.stripe_subscription_id as string;
    const priceIdFromRow = row.stripe_price_id as string | null;
    const periodEndIso = row.current_period_end as string;

    try {
      // Email lookup — per-user `getUserById` keeps us from paging
      // through `listUsers` on every cron tick once the user base
      // grows. The trial-ending pool is small relative to the full
      // user count (only users mid-trial).
      const { data: userData, error: userErr } =
        await admin.auth.admin.getUserById(userId);
      if (userErr || !userData?.user?.email) {
        skipped++;
        continue;
      }
      const email = userData.user.email;

      // Pull the live subscription so the amount + currency we
      // quote in the email match what Stripe will actually charge.
      // Reading from the DB row could be stale if a plan change
      // happened mid-trial.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const item = subscription.items.data[0];
      const price = item?.price;
      if (!price || price.unit_amount == null) {
        // No price metadata — likely a free trial of a deleted
        // price. Stamp as sent so we don't keep retrying.
        await admin
          .from("profiles")
          .update({ trial_ending_email_sent_at: new Date().toISOString() })
          .eq("user_id", userId);
        skipped++;
        continue;
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      const { subject, html, text } = trialEndingEmail({
        appUrl,
        trialEnd: new Date(periodEndIso),
        tierLabel: tierLabelFromPriceId(price.id || priceIdFromRow),
        amountCents: price.unit_amount,
        currency: price.currency,
        portalUrl: portalSession.url,
      });

      const result = await sendEmail({ to: email, subject, html, text });
      if ("ok" in result && result.ok) {
        sent++;
        // Best-effort stamp. If this UPDATE fails, the next cron
        // tick re-sends — annoying but bounded (the row falls out
        // of the window after 48h regardless).
        await admin
          .from("profiles")
          .update({ trial_ending_email_sent_at: new Date().toISOString() })
          .eq("user_id", userId);
      } else if ("skipped" in result) {
        console.warn(
          `[cron/trial-ending] email send skipped: ${result.reason}`,
        );
        return NextResponse.json({
          sent,
          skipped: skipped + (candidates.length - sent - errors),
          errors,
          reason: result.reason,
        });
      } else {
        console.error("[cron/trial-ending] send error:", result.error);
        errors++;
      }
    } catch (err) {
      console.error(
        `[cron/trial-ending] user ${userId} failed:`,
        err instanceof Error ? err.message : err,
      );
      errors++;
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
