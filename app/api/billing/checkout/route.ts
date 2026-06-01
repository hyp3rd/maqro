import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { STRIPE_PRICES, getStripe } from "@/lib/billing/stripe";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Create a Stripe Checkout Session for the AI Plus subscription
 *  and return the URL the client should redirect to.
 *
 *  Auth: user-bound cookie client — the user can only upgrade
 *  their own account. We require a signed-in user because the
 *  Stripe customer needs to be associated with our internal
 *  user_id (carried in `metadata`) so the webhook can flip the
 *  right profile row.
 *
 *  Flow:
 *    1. Look up the caller's profile row.
 *    2. If they already have a stripe_customer_id, reuse it.
 *       Otherwise, create a new Stripe Customer with our user_id
 *       in metadata and save the customer ID.
 *    3. Create a Checkout Session for the configured price,
 *       passing the customer and our user_id so the webhook can
 *       cross-reference both ways.
 *    4. Return { url }. The client does `window.location = url`.
 *
 *  Note on bot protection: this route used to gate behind
 *  `requireHumanDeep()` because of the "card-test / abuse vector"
 *  concern. Removed after observing the same false-positive
 *  pattern that took down the basic-tier gate (see
 *  `lib/bot-protection.ts` history comment): BotID's deep-analysis
 *  classifier was 403-ing real authenticated users in production —
 *  Arc browsers, installed PWAs, anyone whose fingerprint sits
 *  outside the classifier's happy path. The threat doesn't justify
 *  the friction here: this route doesn't move money, it just mints
 *  a Stripe Checkout Session URL. Card testing happens at Stripe,
 *  where Stripe's own anti-fraud and Radar rules run — that's
 *  where the defense belongs. Plus the route already requires an
 *  authenticated Supabase session before any work happens, which
 *  is a much stronger filter than BotID against scripted abuse. */
export async function POST(req: Request): Promise<NextResponse> {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }

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
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  let interval: "month" | "year" = "month";
  let plan: "plus" | "pro" = "plus";
  try {
    const body = (await req.json()) as {
      interval?: "month" | "year";
      plan?: "plus" | "pro";
    };
    if (body.interval === "year") interval = "year";
    if (body.plan === "pro") plan = "pro";
  } catch {
    // Empty body is fine — fall through with defaults (monthly Plus).
  }

  const priceLookup =
    plan === "pro"
      ? interval === "year"
        ? STRIPE_PRICES.proYearly
        : STRIPE_PRICES.proMonthly
      : interval === "year"
        ? STRIPE_PRICES.aiPlusYearly
        : STRIPE_PRICES.aiPlusMonthly;
  const priceId = priceLookup();
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price for ${plan} ${interval}ly is not configured.` },
      { status: 503 },
    );
  }

  // 1. Fetch profile to read (or initialize) the Stripe customer.
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = profile?.stripe_customer_id as string | null;

  if (!customerId) {
    // First-time upgrade — create a Stripe customer. `metadata`
    // carries our user_id both ways: the webhook reads
    // `customer.metadata.user_id` as a fallback when the
    // subscription event doesn't carry it directly.
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;

    // Persist the customer ID so future checkouts reuse it.
    // Service-role insert because the user might not yet have a
    // profile row (new sign-ups have one, but defense in depth)
    // and the upsert needs RLS-bypass to handle either case
    // cleanly.
    const adminConfig = getSupabaseSecretConfig();
    if (adminConfig) {
      const admin = createClient(adminConfig.url, adminConfig.secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await admin
        .from("profiles")
        .upsert(
          { user_id: user.id, stripe_customer_id: customerId },
          { onConflict: "user_id" },
        );
    }
  }

  // 2. Create the Checkout Session. `subscription` mode is the
  // right one for recurring; `payment` is for one-shots. We pass
  // `client_reference_id` AND embed user_id in `metadata` —
  // belt-and-suspenders for the webhook handler.
  //
  // Stripe Tax block: `automatic_tax.enabled = true` makes Stripe
  // compute VAT / GST / sales-tax based on the customer's
  // location (which is captured during the session via
  // `billing_address_collection`). `tax_id_collection.enabled =
  // true` adds the optional "Add VAT number" field so B2B EU
  // buyers can supply a valid VAT ID and have the invoice issued
  // under reverse-charge. `customer_update.{name,address} = auto`
  // is *mandatory* when combining `automatic_tax` with a saved
  // customer: Stripe needs to write the captured address back to
  // the customer object so subsequent invoices know where the
  // customer lives. Without it, the session creation fails with
  // an InvalidRequestError.
  const appUrl = getAppUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    // Where Stripe sends the browser after the checkout finishes.
    // The `{CHECKOUT_SESSION_ID}` template is filled by Stripe.
    success_url: `${appUrl}/app?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/app?upgrade_cancelled=1`,
    billing_address_collection: "auto",
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    subscription_data: {
      // Trial period — 7 days, no card-up-front. Stripe places
      // the subscription in "trialing" status which our
      // ENTITLED_STATUSES set treats as paid.
      trial_period_days: 7,
      metadata: { user_id: user.id },
    },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe returned a session without a URL." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}
