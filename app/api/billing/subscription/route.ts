import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

const PatchBodySchema = z.object({ action: z.enum(["cancel", "resume"]) });

/** `/api/billing/subscription` - Settings → Billing reads + mutates.
 *
 *    - **GET** - returns the caller's current subscription state +
 *      the upcoming invoice preview (next charge date + amount).
 *      Useful for showing "Next charge: $X on YYYY-MM-DD" in the
 *      Billing section without redirecting to the Stripe Portal.
 *    - **PATCH** - toggles `cancel_at_period_end`. The two valid
 *      actions are `"cancel"` (sets to true → access through end
 *      of the paid period, then downgrade) and `"resume"` (sets
 *      to false → reinstates auto-renew). We deliberately don't
 *      offer immediate cancellation because pro-rated refunds
 *      complicate accounting and the at-period-end semantics
 *      match Stripe Portal's default.
 *
 *  All other surface area - plan switching, payment-method update,
 *  invoice PDFs - either lives in `/api/billing/portal` (Stripe-
 *  hosted Customer Portal) or in `/api/billing/invoices` (list).
 *
 *  Auth: cookie-bound server client, so the user can only ever
 *  read or mutate THEIR OWN subscription. We never look up a
 *  customer by email or any other client-supplied key. */

type SubscriptionView = {
  id: string;
  status: Stripe.Subscription.Status;
  /** Active price's nickname (e.g. "Plus monthly") if Stripe has
   *  one configured; otherwise the price ID for debugging. */
  planLabel: string;
  /** ISO timestamp the current paid period ends. After this date
   *  Stripe either renews (cancel_at_period_end=false) or
   *  cancels (cancel_at_period_end=true). */
  currentPeriodEnd: string;
  /** True if the user has cancelled and is riding out the paid
   *  window - the "Resume" CTA shows up. */
  cancelAtPeriodEnd: boolean;
};

type UpcomingView = {
  amount: number;
  currency: string;
  /** Unix-seconds. Stripe gives this as `next_payment_attempt`
   *  on the upcoming invoice (when the renewal hasn't been
   *  blocked by a past_due retry schedule). */
  nextPaymentAttempt: number | null;
};

async function loadCustomerId(): Promise<
  { ok: true; customerId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      ),
    };
  }
  // AAL2 gate wrapped in the Result shape this helper returns,
  // not the bare `return gate.response` other routes use.
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return { ok: false, response: gate.response };
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No subscription." },
        { status: 404 },
      ),
    };
  }
  return { ok: true, customerId };
}

/** Build a human-friendly plan label for the Settings UI. Two
 *  sources in order of editorial quality:
 *
 *    1. The price's nickname (set in the Stripe dashboard). When
 *       configured, it's the most curated label ("Plus monthly").
 *       Often unset on the first money-mover into Stripe.
 *    2. The amount + interval ("$9.99 / month"). Every active
 *       price has both fields; no dashboard config required.
 *
 *  The previous fallback was just `price.id` (the `price_xxx`
 *  identifier), which is a useless string in front of a paying
 *  customer. Product-name was tempting as a middle source but
 *  expanding `data.items.data.price.product` is 5 levels deep
 *  and Stripe caps `expand` at 4 - the list call would 500.
 *  Skip the product detour; amount+interval is enough. */
function planLabelFromPrice(price: Stripe.Price | string | null): string {
  if (!price) return "unknown";
  if (typeof price === "string") return price;
  if (price.nickname) return price.nickname;

  const interval = price.recurring?.interval;
  const intervalLabel = interval
    ? interval === "month"
      ? "month"
      : interval === "year"
        ? "year"
        : interval === "week"
          ? "week"
          : "day"
    : null;

  if (price.unit_amount != null && intervalLabel) {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.unit_amount / 100);
    return `${formatted} / ${intervalLabel}`;
  }
  // Genuinely nothing useful to show. The price id is at least
  // searchable in the Stripe dashboard.
  return price.id;
}

function mapSubscription(sub: Stripe.Subscription): SubscriptionView {
  // A subscription has an `items.data[]` array - for our single-
  // plan setup there's always exactly one. Defensive against a
  // future multi-item shape: pick the first item's price and
  // billing period. As of API version 2025+, `current_period_end`
  // moved from the Subscription level down to each
  // SubscriptionItem (multi-item subs can have staggered billing
  // cycles). With one item per sub, this is functionally the
  // same value - just sourced from the item.
  const firstItem = sub.items.data[0];
  const periodEndSeconds = firstItem?.current_period_end ?? 0;
  // ISO so client-side `new Date(s).toLocaleDateString()` formats
  // consistently with the rest of the app's date columns.
  const periodEnd = new Date(periodEndSeconds * 1000).toISOString();
  return {
    id: sub.id,
    status: sub.status,
    planLabel: planLabelFromPrice(firstItem?.price ?? null),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export async function GET(): Promise<NextResponse> {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }
  const auth = await loadCustomerId();
  if (!auth.ok) return auth.response;

  // List active subscriptions for the customer. `limit: 1` is
  // enough - our checkout flow only ever creates one subscription
  // per customer, and the webhook handler doesn't upgrade/swap;
  // changes happen as updates to the existing subscription.
  const subs = await stripe.subscriptions.list({
    customer: auth.customerId,
    status: "all",
    limit: 1,
    // `data.items.data.price` is 4 levels - at Stripe's expand
    // depth ceiling. Don't push deeper (e.g. `.product`) or the
    // list call 500s with "max expansion depth exceeded".
    expand: ["data.items.data.price"],
  });
  const sub = subs.data[0];
  if (!sub) {
    return NextResponse.json({ error: "No subscription." }, { status: 404 });
  }

  // Upcoming invoice - null when the subscription is fully
  // cancelled (Stripe has no next billing event to preview).
  // The SDK renamed `invoices.retrieveUpcoming` to
  // `invoices.createPreview` in recent API versions; it still
  // throws on "no upcoming invoice" rather than returning null,
  // so wrap.
  let upcoming: UpcomingView | null = null;
  if (sub.status !== "canceled" && !sub.cancel_at_period_end) {
    try {
      const inv = await stripe.invoices.createPreview({
        customer: auth.customerId,
      });
      upcoming = {
        amount: inv.amount_due,
        currency: inv.currency,
        nextPaymentAttempt: inv.next_payment_attempt,
      };
    } catch {
      // "invoice_upcoming_none" or similar - leave null. The UI
      // already handles the null case (just shows "-" for the
      // next-charge line).
    }
  }

  return NextResponse.json({ subscription: mapSubscription(sub), upcoming });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }
  const auth = await loadCustomerId();
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, PatchBodySchema);
  if (!parsed.ok) return parsed.response;
  const { action } = parsed.data;

  const subs = await stripe.subscriptions.list({
    customer: auth.customerId,
    status: "all",
    limit: 1,
  });
  const sub = subs.data[0];
  if (!sub) {
    return NextResponse.json({ error: "No subscription." }, { status: 404 });
  }
  // Already-canceled (status="canceled") subscriptions can't be
  // reanimated via PATCH - Stripe requires a brand-new Checkout
  // Session. Surface a 409 so the client knows to send the user
  // to the upgrade flow rather than confusing them with a
  // generic 500.
  if (sub.status === "canceled") {
    return NextResponse.json(
      {
        error:
          "This subscription is already cancelled. Start a new checkout to resubscribe.",
      },
      { status: 409 },
    );
  }

  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: action === "cancel",
    // Stripe's `cancel_at_period_end: false` "resumes" the
    // subscription by clearing the pending cancel; no other args
    // needed for either action.
  });

  return NextResponse.json({ subscription: mapSubscription(updated) });
}
