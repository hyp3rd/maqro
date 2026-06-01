import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Create a Stripe Customer Portal Session for self-serve
 *  subscription management — cancel, update payment method,
 *  download invoices, change plan if multiple are configured.
 *
 *  The Customer Portal is configured in the Stripe dashboard
 *  (allowed actions, branding) so this route is intentionally
 *  thin — pass the customer, get back a URL, redirect.
 *
 *  Returns 404-shape (no portal) when the user has never paid
 *  (no stripe_customer_id). The Settings UI should hide the
 *  "Manage subscription" button in that case. */
export async function POST(): Promise<NextResponse> {
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return NextResponse.json(
      { error: "No active subscription to manage." },
      { status: 404 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppUrl()}/`,
  });
  return NextResponse.json({ url: session.url });
}
