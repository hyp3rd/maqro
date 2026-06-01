import Stripe from "stripe";

/** Server-only Stripe client.
 *
 *  Lazy-init so the module imports cleanly in environments without
 *  Stripe configured (local dev with no key, CI tests, the build
 *  step). Routes that need the client call `getStripe()` and get
 *  back either a configured instance or `null` — they must handle
 *  the null case by returning 503 rather than crashing.
 *
 *  We pin `apiVersion` explicitly so a backwards-incompatible
 *  default change in the SDK doesn't silently shift our wire
 *  format. Bump deliberately when we audit the changelog. */

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    cached = null;
    return null;
  }
  cached = new Stripe(key, {
    // Stripe API version we tested against. The SDK warns at
    // runtime when the configured key's account default differs;
    // resolve those warnings by either bumping here (with a
    // changelog read) or pinning the account default in the
    // Stripe dashboard.
    apiVersion: "2026-05-27.dahlia",
    typescript: true,
    // App identifier for Stripe's analytics — helps them attribute
    // traffic and helps us when contacting support.
    appInfo: { name: "Maqro", version: "0.1" },
  });
  return cached;
}

/** Price IDs surfaced as a single source of truth so the checkout
 *  route, the webhook handler, and any future portal config don't
 *  fall out of sync. Set via env at deploy time — different envs
 *  (test, prod) have different price IDs. */
export const STRIPE_PRICES = {
  /** Monthly recurring price for the "AI Plus" plan. */
  aiPlusMonthly: () => process.env.STRIPE_PRICE_AI_PLUS_MONTHLY ?? null,
  /** Yearly (≈20% cheaper) recurring price for the "AI Plus" plan.
   *  Surfaced as a toggle in the upgrade dialog. */
  aiPlusYearly: () => process.env.STRIPE_PRICE_AI_PLUS_YEARLY ?? null,
  /** Monthly recurring price for the "Pro" plan — unlimited AI
   *  plus sync / cloud / email gating. */
  proMonthly: () => process.env.STRIPE_PRICE_PRO_MONTHLY ?? null,
  /** Yearly Pro price (≈20% cheaper). */
  proYearly: () => process.env.STRIPE_PRICE_PRO_YEARLY ?? null,
};

/** Stripe statuses we treat as "entitled" — the user gets the
 *  benefits of a paid plan. `past_due` is debatable: the
 *  conservative read is "they failed to pay, downgrade now"; the
 *  pragmatic read is "Stripe is mid-retry and we don't want to
 *  punish a transient card-network issue". We pick pragmatic and
 *  rely on `canceled` to be the actual downgrade signal. */
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Map a Stripe price ID to a user-facing tier label ("AI Plus",
 *  "Pro"). Falls back to "subscription" for an unrecognized price
 *  (admin-created custom price, schema drift) so emails and UI still
 *  read coherently rather than printing a raw `price_xxx` id. */
export function tierLabelFromPriceId(priceId: string | null): string {
  if (!priceId) return "subscription";
  if (
    priceId === STRIPE_PRICES.proMonthly() ||
    priceId === STRIPE_PRICES.proYearly()
  ) {
    return "Pro";
  }
  if (
    priceId === STRIPE_PRICES.aiPlusMonthly() ||
    priceId === STRIPE_PRICES.aiPlusYearly()
  ) {
    return "AI Plus";
  }
  return "subscription";
}
