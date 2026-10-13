import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import {
  type BillingInterval,
  type PaidPlan,
  getStripe,
  pickLiveSubscription,
  priceIdForPlan,
} from "@/lib/billing/stripe";
import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

const ROUTE = "/api/billing/checkout";

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
 *       in metadata and store its ID with a checked UPDATE of the
 *       profiles row (migration 0074 creates it at sign-up). If the
 *       ID can't be stored, no Checkout Session is created: a
 *       subscription on a customer no profile knows bills the user
 *       without ever entitling them.
 *    3. Refuse (409 `subscription_exists`) when the customer already
 *       has a live subscription. A second subscription double-bills,
 *       and the webhook can track only one; a plan change goes
 *       through `/api/billing/change-plan`, which updates the
 *       existing subscription.
 *    4. Expire the customer's other open Checkout Sessions, so two
 *       tabs can't each complete a subscription.
 *    5. Create a Checkout Session for the configured price,
 *       passing the customer and our user_id so the webhook can
 *       cross-reference both ways.
 *    6. Return { url }. The client does `window.location = url`.
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

  let interval: BillingInterval = "month";
  let plan: PaidPlan = "plus";
  try {
    const body = (await req.json()) as {
      interval?: BillingInterval;
      plan?: PaidPlan;
    };
    if (body.interval === "year") interval = "year";
    if (body.plan === "pro") plan = "pro";
  } catch {
    // Empty body is fine — fall through with defaults (monthly Plus).
  }

  const priceId = priceIdForPlan(plan, interval);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price for ${plan} ${interval}ly is not configured.` },
      { status: 503 },
    );
  }

  // 1. Fetch profile to read (or initialize) the Stripe customer.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    await reportServerError(profileError, {
      route: ROUTE,
      context: { step: "profile-read" },
    });
    return NextResponse.json(
      { error: "Couldn't load your account. Try again in a moment." },
      { status: 500 },
    );
  }

  // 2. First-time subscriber: create the customer and link it.
  let customerId = (profile?.stripe_customer_id ?? null) as string | null;
  if (!customerId) {
    const linked = await createAndLinkCustomer(stripe, supabase, user);
    if (!linked.ok) return linked.response;
    customerId = linked.customerId;
  }

  // 3. One live subscription per customer.
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const live = pickLiveSubscription(subscriptions.data);
  if (live) {
    return NextResponse.json(
      {
        error:
          "You already have a subscription. Change your plan instead of starting a new one.",
        code: "subscription_exists",
      },
      { status: 409 },
    );
  }

  // 4. Only the newest Checkout Session may complete.
  const openSessions = await stripe.checkout.sessions.list({
    customer: customerId,
    status: "open",
    limit: 100,
  });
  for (const open of openSessions.data) {
    try {
      await stripe.checkout.sessions.expire(open.id);
    } catch (err) {
      // It completed (or expired) in the meantime. Don't race it with a
      // second session; a retry sees the outcome.
      await reportServerError(err, {
        route: ROUTE,
        context: { step: "expire-open-session", sessionId: open.id },
      });
      return NextResponse.json(
        { error: "Couldn't start checkout. Try again in a moment." },
        { status: 502 },
      );
    }
  }

  // 5. Create the Checkout Session. `subscription` mode is the
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

type CheckoutUser = { id: string; email?: string };

async function billingSetupFailed(
  step: string,
  err: unknown,
): Promise<{ ok: false; response: NextResponse }> {
  await reportServerError(err, { route: ROUTE, context: { step } });
  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          "We couldn't set up billing for your account. Try again in a moment.",
      },
      { status: 503 },
    ),
  };
}

/** Create a Stripe customer for a first-time subscriber and store its ID on
 *  their profiles row.
 *
 *  The write is a service-role UPDATE (end users can't write billing
 *  columns) that must match the row, and only while the row has no
 *  customer yet: a concurrent checkout that linked first wins, and we
 *  continue with its customer — the one we just created stays unused and
 *  never bills. Anything else refuses the checkout. */
async function createAndLinkCustomer(
  stripe: Stripe,
  supabase: SupabaseClient,
  user: CheckoutUser,
): Promise<
  { ok: true; customerId: string } | { ok: false; response: NextResponse }
> {
  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return billingSetupFailed(
      "customer-link",
      new Error("SUPABASE_SECRET_KEY is not configured"),
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // `metadata` carries our user_id both ways: the webhook reads
  // `subscription.metadata.user_id` to link a customer no profile
  // carries yet.
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { user_id: user.id },
  });

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("user_id", user.id)
    .is("stripe_customer_id", null)
    .select("user_id");
  if (updateError) return billingSetupFailed("customer-link", updateError);
  if (updated && updated.length === 1) {
    return { ok: true, customerId: customer.id };
  }

  // 0 rows: either a concurrent checkout linked its customer first, or
  // the account has no profiles row at all.
  const { data: current, error: rereadError } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rereadError)
    return billingSetupFailed("customer-link-reread", rereadError);
  const existing = (current?.stripe_customer_id ?? null) as string | null;
  if (existing) return { ok: true, customerId: existing };
  return billingSetupFailed(
    "customer-link",
    new Error(`no profiles row to link ${customer.id} to`),
  );
}
