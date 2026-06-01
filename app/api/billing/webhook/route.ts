import { getStripe } from "@/lib/billing/stripe";
import { dispatchStripeEvent } from "@/lib/billing/webhook-handlers";
import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Stripe webhook handler.
 *
 *  Critical invariants:
 *
 *  1. **Signature verification.** The raw request body is verified
 *     against the `Stripe-Signature` header using the webhook
 *     signing secret. Without this, anyone could POST a fake
 *     "subscription active" event and upgrade themselves for free.
 *
 *  2. **Idempotency.** Stripe retries on any non-2xx (and
 *     occasionally delivers duplicates even on 2xx). We persist
 *     every processed event ID to `stripe_webhook_events` and
 *     no-op on duplicates. The unique-key INSERT is the atomic
 *     gate — racing requests can't both pass.
 *
 *  3. **Service-role writes only.** The handler runs without a
 *     user session — it's hit by Stripe, not a logged-in caller —
 *     so it bypasses RLS via the service-role client.
 *
 *  4. **Bail loudly on schema drift.** If we can't find the
 *     profile for a customer ID, we log and return 200 anyway (so
 *     Stripe stops retrying), but the error is captured in
 *     `error_log` so the maintainer sees it.
 *
 *  Payload + status persistence: from migration 0027 onward we
 *  store the full event payload and the dispatch outcome on the
 *  same row. That lets the admin viewer surface "what was actually
 *  sent" and lets the admin-replay route re-run dispatch against
 *  the saved payload without re-fetching from Stripe.
 *
 *  Dispatch itself lives in `lib/billing/webhook-handlers.ts` so
 *  the replay route can share it. */
export async function POST(req: Request): Promise<NextResponse> {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret is not configured." },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing Stripe-Signature header." },
      { status: 400 },
    );
  }

  // Stripe requires the raw body for signature verification. Next's
  // `req.json()` consumes the body, so we read text first.
  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    // Bad signature — either misconfigured secret or an attacker.
    // Either way we don't trust the payload.
    console.error("[stripe/webhook] signature verify failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
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

  // Idempotency gate. We insert the event id+type+payload upfront;
  // status fields get populated after dispatch. The unique-key
  // collision is what dedups — racing duplicate deliveries both
  // hit the same row, only one wins the INSERT, the other returns
  // 200 immediately.
  const { error: insertError } = await admin
    .from("stripe_webhook_events")
    .insert({ id: event.id, type: event.type, payload: event });
  if (insertError) {
    if (insertError.code === "23505") {
      // Duplicate — already processed.
      return NextResponse.json({ duplicate: true });
    }
    console.error("[stripe/webhook] idempotency insert failed:", insertError);
    return NextResponse.json(
      { error: "Idempotency check failed." },
      { status: 500 },
    );
  }

  const outcome = await dispatchStripeEvent(event, admin, stripe);

  // Record the dispatch result on the same row so the admin viewer
  // can show success vs failure without joining error_log.
  await admin
    .from("stripe_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_status: outcome.status,
      processing_error:
        outcome.status === "error" ? outcome.error.message : null,
    })
    .eq("id", event.id);

  if (outcome.status === "error") {
    // Don't let Stripe retry forever — return 200 but capture the
    // error so we can investigate. A failed handler with the
    // idempotency row already written means the next delivery
    // would no-op anyway. Admin can replay from the viewer once
    // the root cause is fixed.
    await reportServerError(outcome.error, {
      route: "/api/billing/webhook",
      context: { event_id: event.id, event_type: event.type },
    });
    return NextResponse.json({ received: true, handler_error: true });
  }

  return NextResponse.json({ received: true });
}
