import {
  getStripe,
  isLiveSubscription,
  isStripeResourceMissing,
} from "@/lib/billing/stripe";
import { reportServerError } from "@/lib/error-reporter";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cascade-delete a user account. Mirrors the steps the self-serve
 *  /api/delete-account route does, factored out so the admin-driven
 *  "delete this user" action takes the same path. Three side-effects
 *  in strict order — re-ordering breaks data integrity:
 *
 *    1. **Cancel active Stripe subscriptions.** If we drop the
 *       `auth.users` row first, Stripe keeps billing — it has no
 *       idea the user is gone, and the cascade erases the profile
 *       row that is the only link from the customer to the user (the
 *       user can no longer reach the billing portal either).
 *       Cancellation is immediate (`prorate: false`) because the
 *       account is being erased; a credit on a soon-orphan customer
 *       record helps no one. This step GATES the deletion: if any
 *       subscription can't be confirmed cancelled (profile lookup,
 *       list or cancel failure, or Stripe unconfigured while the user
 *       has a customer), nothing is deleted and the caller gets a
 *       retryable error. A subscription Stripe no longer has, or one
 *       already ended, counts as cancelled. Cancelling is idempotent,
 *       so a retry is safe.
 *
 *    2. **Remove Storage objects under the user's prefix.** Bucket
 *       contents live in `storage.objects`, not the app schema,
 *       so the `auth.users` cascade doesn't reach them. The
 *       `exports` bucket is currently the only place users write
 *       blobs; extend this list if you add more.
 *
 *    3. **Delete the `auth.users` row.** ON DELETE CASCADE walks
 *       every app table from migration 0001 onward. This is the
 *       step that erases the user — return its error to the
 *       caller. Step 2 is best-effort.
 *
 *  The caller passes a pre-built service-role admin client so the
 *  helper doesn't need to know how secrets are loaded. */
export async function cascadeDeleteUser(opts: {
  userId: string;
  admin: SupabaseClient;
  /** Tag the error_log entries with the calling route so on-call
   *  knows whether a stuck Stripe sub came from the self-serve or
   *  the admin-driven path. */
  callerRoute: string;
}): Promise<CascadeDeleteResult> {
  const billing = await cancelStripeSubscriptions(
    opts.admin,
    opts.userId,
    opts.callerRoute,
  );
  if (!billing.ok) return billing;

  await removeStorageObjects(opts.admin, opts.userId, opts.callerRoute);

  const { error } = await opts.admin.auth.admin.deleteUser(opts.userId);
  if (error) {
    await reportServerError(error, {
      route: opts.callerRoute,
      context: { userId: opts.userId, step: "auth-delete" },
    });
    return { ok: false, status: 500, error: error.message };
  }
  return { ok: true };
}

/** `status` is the HTTP status the caller should answer with. */
export type CascadeDeleteResult =
  { ok: true } | { ok: false; status: number; error: string };

type BillingRefusal = { ok: false; status: number; error: string };

const BILLING_REFUSAL_COPY =
  "We couldn't cancel the subscription with our payment provider, so the account was not deleted. Nothing was changed - try again in a few minutes.";

async function refuseDeletion(
  status: number,
  err: unknown,
  report: { route: string; context: Record<string, unknown> },
): Promise<BillingRefusal> {
  await reportServerError(err, report);
  return { ok: false, status, error: BILLING_REFUSAL_COPY };
}

async function cancelStripeSubscriptions(
  admin: SupabaseClient,
  userId: string,
  callerRoute: string,
): Promise<{ ok: true } | BillingRefusal> {
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileErr) {
    return refuseDeletion(503, profileErr, {
      route: callerRoute,
      context: { userId, step: "profile-lookup" },
    });
  }
  const customerId = (profile?.stripe_customer_id ?? null) as string | null;
  if (!customerId) return { ok: true };

  const stripe = getStripe();
  if (!stripe) {
    return refuseDeletion(
      503,
      new Error("STRIPE_SECRET_KEY is not configured"),
      {
        route: callerRoute,
        context: { userId, customerId, step: "stripe-config" },
      },
    );
  }

  let subs: Stripe.ApiList<Stripe.Subscription>;
  try {
    subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
  } catch (err) {
    // A customer Stripe no longer has bills nothing.
    if (isStripeResourceMissing(err)) return { ok: true };
    return refuseDeletion(502, err, {
      route: callerRoute,
      context: { userId, customerId, step: "stripe-list" },
    });
  }

  // Stripe rejects `cancel` on terminal statuses, so filter before
  // calling. Every live status still implies billing intent. Try every
  // subscription before refusing, so a retry has less left to do.
  let failed = false;
  for (const sub of subs.data) {
    if (!isLiveSubscription(sub)) continue;
    try {
      await stripe.subscriptions.cancel(sub.id, { prorate: false });
    } catch (err) {
      if (
        isStripeResourceMissing(err) ||
        (await subscriptionHasEnded(stripe, sub.id))
      ) {
        continue;
      }
      await reportServerError(err, {
        route: callerRoute,
        context: {
          userId,
          customerId,
          subscriptionId: sub.id,
          step: "stripe-cancel",
        },
      });
      failed = true;
    }
  }
  if (failed) {
    return { ok: false, status: 502, error: BILLING_REFUSAL_COPY };
  }
  return { ok: true };
}

/** After a failed cancel: whether the subscription is gone or already
 *  ended anyway (deleted in Stripe, or cancelled concurrently). Any doubt
 *  — including a failed re-check — counts as still billing. */
async function subscriptionHasEnded(
  stripe: Stripe,
  subscriptionId: string,
): Promise<boolean> {
  try {
    return !isLiveSubscription(
      await stripe.subscriptions.retrieve(subscriptionId),
    );
  } catch (err) {
    return isStripeResourceMissing(err);
  }
}

async function removeStorageObjects(
  admin: SupabaseClient,
  userId: string,
  callerRoute: string,
): Promise<void> {
  try {
    const { data: files, error: listErr } = await admin.storage
      .from("exports")
      .list(userId, { limit: 1000 });
    if (listErr) throw listErr;
    if (!files || files.length === 0) return;
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error: removeErr } = await admin.storage
      .from("exports")
      .remove(paths);
    if (removeErr) throw removeErr;
  } catch (err) {
    await reportServerError(err, {
      route: callerRoute,
      context: { userId, step: "storage-cleanup" },
    });
  }
}
