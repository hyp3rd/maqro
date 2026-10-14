import { parseBody } from "@/lib/api/parse-body";
import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import {
  getStripe,
  pickLiveSubscription,
  priceIdForPlan,
} from "@/lib/billing/stripe";
import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const ROUTE = "/api/billing/change-plan";

const BodySchema = z.object({
  plan: z.enum(["plus", "pro"]),
  interval: z.enum(["month", "year"]),
});

/** Statuses whose plan can be changed here. A past_due / unpaid / paused /
 *  incomplete subscription needs its payment sorted out first (Settings →
 *  Billing → Update payment); changing its price would only stack another
 *  charge on an unpaid invoice. */
const CHANGEABLE_STATUSES = new Set(["active", "trialing"]);

/** POST `{ plan, interval }` — switch an existing subscriber to another
 *  plan or billing interval and return the URL to redirect to.
 *
 *  The change happens on the customer's existing subscription, never by
 *  starting a second one (`/api/billing/checkout` refuses a customer with a
 *  live subscription). The URL is a Stripe Billing Portal
 *  `subscription_update_confirm` deep link for that subscription's single
 *  item and the new price: Stripe shows the customer the change and the
 *  prorated amount, collects payment (3-D Secure included) and applies it;
 *  the resulting `customer.subscription.updated` webhook updates the
 *  profile's tier. See https://docs.stripe.com/customer-management/portal-deep-links.
 *
 *  Stripe requires every target price to be listed in the portal
 *  configuration's `features.subscription_update.products`
 *  (docs/configuration.md); otherwise session creation fails and this
 *  route answers 502. */
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

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { plan, interval } = parsed.data;

  const priceId = priceIdForPlan(plan, interval);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price for ${plan} ${interval}ly is not configured.` },
      { status: 503 },
    );
  }

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
  const customerId = (profile?.stripe_customer_id ?? null) as string | null;
  const noSubscription = NextResponse.json(
    {
      error: "You don't have a subscription to change.",
      code: "no_subscription",
    },
    { status: 404 },
  );
  if (!customerId) return noSubscription;

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const live = pickLiveSubscription(subscriptions.data);
  if (!live) return noSubscription;

  if (!CHANGEABLE_STATUSES.has(live.status)) {
    return NextResponse.json(
      {
        error:
          "Your last payment didn't go through. Update your payment method in Settings → Billing, then change your plan.",
      },
      { status: 409 },
    );
  }

  const item = live.items.data[0];
  if (!item || live.items.data.length !== 1) {
    // The portal can only update single-item subscriptions.
    return NextResponse.json(
      {
        error:
          "This subscription can't be changed here. Contact support to switch plans.",
      },
      { status: 409 },
    );
  }
  if (item.price.id === priceId) {
    return NextResponse.json(
      { error: "You're already on this plan." },
      { status: 409 },
    );
  }

  const settingsUrl = `${getAppUrl()}/app?view=settings`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: settingsUrl,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: live.id,
          items: [{ id: item.id, price: priceId, quantity: 1 }],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: settingsUrl },
        },
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    await reportServerError(err, {
      route: ROUTE,
      context: { step: "portal-session", subscriptionId: live.id, plan },
    });
    return NextResponse.json(
      {
        error:
          "Couldn't open the plan change. Try again, or use Manage subscription in Settings → Billing.",
      },
      { status: 502 },
    );
  }
}
