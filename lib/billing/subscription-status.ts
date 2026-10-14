/** Stripe subscription statuses that still bill the customer, or can start
 *  billing again without a new checkout. A customer with one of these must
 *  not get a second subscription: a plan change goes through the existing
 *  one. Only `canceled` and `incomplete_expired` are terminal in Stripe.
 *
 *  Kept free of the Stripe SDK so client components (the upgrade dialog)
 *  can make the same call the server does. */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

export function isLiveSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return status != null && LIVE_SUBSCRIPTION_STATUSES.has(status);
}
