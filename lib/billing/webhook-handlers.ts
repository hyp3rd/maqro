import { getAppUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/resend";
import {
  paymentFailedFinalEmail,
  subscriptionCancelledEmail,
  subscriptionConfirmedEmail,
} from "@/lib/email/templates";
import type Stripe from "stripe";
import { type SupabaseClient } from "@supabase/supabase-js";
import { ENTITLED_STATUSES, tierLabelFromPriceId } from "./stripe";

/** Stripe-event dispatcher and per-event handlers.
 *
 *  Lifted out of [`app/api/billing/webhook/route.ts`](../../app/api/billing/webhook/route.ts)
 *  so the admin **replay** route can re-run the same dispatch against
 *  a payload that's already been persisted. Without this split, the
 *  replay route would either duplicate logic (drift hazard) or copy-
 *  paste the switch statement (the obvious wrong abstraction).
 *
 *  The dispatcher returns the dispatch outcome rather than throwing
 *  on a handler error — callers may want different recovery behavior.
 *  The live webhook route returns 200 either way (to stop Stripe's
 *  retry loop); the replay route surfaces errors back to the admin
 *  UI.
 *
 *  Transactional emails (subscription confirmed, cancelled, payment
 *  failed) are sent INSIDE the handlers with DB-stamp idempotency
 *  rather than at the dispatcher level. Each email type has its own
 *  stamp column on `profiles` so retried events don't double-send. */

/** Per-item `current_period_end` is the canonical source of the
 *  current paid period under Stripe API 2026-04-22 — the top-level
 *  field was removed. Subscriptions in this app are single-item, so
 *  the first item's value is authoritative. Returns null if the
 *  subscription somehow lacks items (shouldn't happen but defense
 *  in depth). */
function periodEndFromSubscription(
  subscription: Stripe.Subscription,
): number | null {
  const first = subscription.items.data[0];
  return first?.current_period_end ?? null;
}

/** Active price ID for a (single-item) subscription. */
function priceIdFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  return subscription.items.data[0]?.price.id ?? null;
}

export type DispatchOutcome =
  { status: "success" } | { status: "error"; error: Error };

/** Route a verified Stripe event to its handler.
 *
 *  Events we don't react to (payment_intent.*, etc.) are not
 *  errors — they're just no-ops. Only handler-thrown exceptions are
 *  surfaced as errors. */
export async function dispatchStripeEvent(
  event: Stripe.Event,
  admin: SupabaseClient,
  stripe: Stripe,
): Promise<DispatchOutcome> {
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          admin,
          stripe,
        );
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.created": {
        await handleSubscriptionChange(
          event.data.object as Stripe.Subscription,
          admin,
        );
        break;
      }
      case "invoice.payment_failed": {
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          admin,
        );
        break;
      }
      case "invoice.payment_succeeded": {
        // Clears the dunning stamp so the next failure cycle starts
        // fresh. No email sent — successful payments are receipts
        // (Stripe sends those natively).
        await handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
          admin,
        );
        break;
      }
      default:
        // Other events we don't react to today. The dispatcher still
        // returns 'success' for these — recording them with a
        // non-error status is what lets the admin viewer show
        // "received but no-op".
        break;
    }
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** When Checkout finishes, Stripe's session has all the IDs we
 *  need: customer, subscription, and our `client_reference_id` or
 *  metadata user_id. We update the profile so the user becomes
 *  entitled immediately, without waiting for the subscription.*
 *  events that follow. */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  admin: SupabaseClient,
  stripe: Stripe,
): Promise<void> {
  if (session.mode !== "subscription") return;

  const userId =
    session.client_reference_id ||
    (session.metadata?.user_id as string | undefined);
  if (!userId) {
    throw new Error(
      `Checkout session ${session.id} has no client_reference_id or metadata.user_id`,
    );
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) return;

  // Re-fetch the subscription to get authoritative status +
  // period end (the session's embedded subscription may be a
  // partial snapshot depending on expand options).
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = priceIdFromSubscription(subscription);

  await admin
    .from("profiles")
    .update({
      stripe_customer_id:
        typeof session.customer === "string"
          ? session.customer
          : (session.customer?.id ?? null),
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      subscription_status: subscription.status,
      current_period_end: (() => {
        const ts = periodEndFromSubscription(subscription);
        return ts ? new Date(ts * 1000).toISOString() : null;
      })(),
      is_premium: ENTITLED_STATUSES.has(subscription.status),
      // Reset the trial-ending email stamp so a fresh subscription
      // (including a user starting a second trial after the first
      // one expired) gets the 24h-out nudge again. Without this
      // reset, the cron's "WHERE trial_ending_email_sent_at IS NULL"
      // gate would mis-classify the new trial as already-nudged.
      trial_ending_email_sent_at: null,
      // Same logic for the cancellation stamp — a fresh subscription
      // means a future cancel should re-confirm. The payment-failed
      // stamp is cleared on `invoice.payment_succeeded` instead,
      // since that's the actual "we're caught up" signal.
      cancellation_email_sent_at: null,
    })
    .eq("user_id", userId);

  // Send the subscription confirmation if we haven't already for
  // this billing cycle. We re-read the row to check the stamp; the
  // update above clears `subscription_confirmed_email_sent_at`
  // indirectly only when a new subscription_id lands (handled by
  // the deleted path below).
  await maybeSendSubscriptionConfirmed({
    admin,
    stripe,
    userId,
    subscription,
    priceId,
  });
}

/** Status changes — the most common ongoing event. The
 *  subscription itself tells us everything we need; we just need
 *  to find which profile to update. */
async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  admin: SupabaseClient,
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Look up the profile by customer ID — that's our cross-
  // reference from "this Stripe event" to "this user". If the
  // lookup fails, the customer was created in Stripe but not
  // tied to a profile (deleted user? schema drift?). Loud
  // failure so the maintainer notices.
  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select(
      "user_id, cancellation_email_sent_at, subscription_confirmed_email_sent_at",
    )
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!profile) {
    throw new Error(`No profile found for Stripe customer ${customerId}`);
  }
  const userId = profile.user_id as string;
  const cancellationStamp = profile.cancellation_email_sent_at as string | null;

  const periodEndTs = periodEndFromSubscription(subscription);
  const willCancel = subscription.cancel_at_period_end === true;

  // Build the update payload. We piggyback the cancellation-stamp
  // reset onto this same update so we never have a "resumed but
  // stamp still set" intermediate state visible to a concurrent
  // delivery.
  const updatePayload: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceIdFromSubscription(subscription),
    subscription_status: subscription.status,
    current_period_end: periodEndTs
      ? new Date(periodEndTs * 1000).toISOString()
      : null,
    is_premium: ENTITLED_STATUSES.has(subscription.status),
  };

  // Resume case: cancel_at_period_end is now false but we previously
  // sent a cancellation email. Clear the stamp so a future cancel
  // sends a fresh confirmation.
  if (!willCancel && cancellationStamp) {
    updatePayload.cancellation_email_sent_at = null;
  }

  await admin.from("profiles").update(updatePayload).eq("user_id", userId);

  // Cancellation email: send once per (cancel_at_period_end true)
  // transition. The stamp guards against re-sends.
  if (willCancel && !cancellationStamp) {
    await sendCancellationEmail({ admin, userId, subscription });
  }
}

/** Stripe `invoice.payment_failed` — fires once per failed attempt.
 *  We only send the dunning-final email when Stripe has decided not
 *  to retry (`next_payment_attempt: null`); the earlier "we'll try
 *  again" attempts get the in-app PastDueBanner instead so we don't
 *  spam the user's inbox over a single declined attempt. */
async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  admin: SupabaseClient,
): Promise<void> {
  // Stripe sets next_payment_attempt to null once it gives up
  // (smart-retry schedule exhausted, or the invoice was marked
  // uncollectible). Anything else is mid-cycle — don't email.
  if (invoice.next_payment_attempt != null) return;

  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) return;

  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select("user_id, stripe_price_id, payment_failed_email_sent_at")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!profile) return; // No profile linked — silently drop.
  if (profile.payment_failed_email_sent_at) return; // Already notified for this cycle.

  const userId = profile.user_id as string;
  const priceId = (profile.stripe_price_id as string | null) ?? null;
  const email = await lookupUserEmail(admin, userId);
  if (!email) return;

  const appUrl = getAppUrl();
  const template = paymentFailedFinalEmail({
    appUrl,
    tierLabel: tierLabelFromPriceId(priceId),
    amountCents: invoice.amount_due ?? 0,
    currency: invoice.currency ?? "usd",
    settingsUrl: `${appUrl}/app?view=settings`,
  });
  const result = await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  if ("ok" in result && result.ok) {
    await admin
      .from("profiles")
      .update({ payment_failed_email_sent_at: new Date().toISOString() })
      .eq("user_id", userId);
  }
}

/** Successful payment lands — clear the dunning stamp so a future
 *  failed cycle gets its own notification. No email here; Stripe
 *  sends receipts natively if enabled in the dashboard. */
async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  admin: SupabaseClient,
): Promise<void> {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) return;

  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select("user_id, payment_failed_email_sent_at")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!profile || !profile.payment_failed_email_sent_at) return;

  await admin
    .from("profiles")
    .update({ payment_failed_email_sent_at: null })
    .eq("user_id", profile.user_id as string);
}

/** Send the cancellation email + stamp the profile. Best-effort:
 *  a send failure leaves the stamp unset so the next webhook
 *  delivery can retry. The webhook itself stays successful — the
 *  email is a side-effect, not the contract. */
async function sendCancellationEmail(opts: {
  admin: SupabaseClient;
  userId: string;
  subscription: Stripe.Subscription;
}): Promise<void> {
  const email = await lookupUserEmail(opts.admin, opts.userId);
  if (!email) return;

  const periodEndTs = periodEndFromSubscription(opts.subscription);
  if (!periodEndTs) return;
  const priceId = priceIdFromSubscription(opts.subscription);
  const appUrl = getAppUrl();

  const template = subscriptionCancelledEmail({
    appUrl,
    tierLabel: tierLabelFromPriceId(priceId),
    accessUntil: new Date(periodEndTs * 1000),
    settingsUrl: `${appUrl}/app?view=settings`,
  });
  const result = await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  if ("ok" in result && result.ok) {
    await opts.admin
      .from("profiles")
      .update({ cancellation_email_sent_at: new Date().toISOString() })
      .eq("user_id", opts.userId);
  }
}

/** Send the subscription-confirmed email IF we haven't already for
 *  the current subscription cycle. We read the stamp from the
 *  profile we just updated; if it's still set from a previous
 *  subscription (shouldn't happen — the checkout handler clears it
 *  via the trial_ending_email_sent_at reset path), we skip. */
async function maybeSendSubscriptionConfirmed(opts: {
  admin: SupabaseClient;
  stripe: Stripe;
  userId: string;
  subscription: Stripe.Subscription;
  priceId: string | null;
}): Promise<void> {
  // Only send for entitled states. A subscription in `incomplete`
  // (initial payment hasn't succeeded yet) isn't worth confirming
  // — the user is still in the checkout flow and the entitled-state
  // webhook will follow shortly.
  if (!ENTITLED_STATUSES.has(opts.subscription.status)) return;

  const { data: profile } = await opts.admin
    .from("profiles")
    .select("subscription_confirmed_email_sent_at")
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (profile?.subscription_confirmed_email_sent_at) return;

  const email = await lookupUserEmail(opts.admin, opts.userId);
  if (!email) return;

  const item = opts.subscription.items.data[0];
  const price = item?.price;
  if (!price || price.unit_amount == null) return;

  const appUrl = getAppUrl();
  const template = subscriptionConfirmedEmail({
    appUrl,
    tierLabel: tierLabelFromPriceId(opts.priceId),
    amountCents: price.unit_amount,
    currency: price.currency,
    intervalLabel: price.recurring?.interval ?? "month",
    settingsUrl: `${appUrl}/app?view=settings`,
  });
  const result = await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  if ("ok" in result && result.ok) {
    await opts.admin
      .from("profiles")
      .update({
        subscription_confirmed_email_sent_at: new Date().toISOString(),
      })
      .eq("user_id", opts.userId);
  }
}

/** Look up a user's email via the admin auth API. Returns null if
 *  the user can't be found or has no email — both indicate the
 *  user is gone (deleted account, schema drift) and emailing is
 *  pointless. */
async function lookupUserEmail(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}
