import { getStripe } from "@/lib/billing/stripe";
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
 *       idea the user is gone. Cancellation is immediate
 *       (`prorate: false`) because the account is being erased; a
 *       credit on a soon-orphan customer record helps no one.
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
 *       caller; the first two are best-effort.
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await cancelStripeSubscriptions(opts.admin, opts.userId, opts.callerRoute);
  await removeStorageObjects(opts.admin, opts.userId, opts.callerRoute);

  const { error } = await opts.admin.auth.admin.deleteUser(opts.userId);
  if (error) {
    await reportServerError(error, {
      route: opts.callerRoute,
      context: { userId: opts.userId, step: "auth-delete" },
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function cancelStripeSubscriptions(
  admin: SupabaseClient,
  userId: string,
  callerRoute: string,
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileErr) {
    await reportServerError(profileErr, {
      route: callerRoute,
      context: { userId, step: "profile-lookup" },
    });
    return;
  }
  const customerId = (profile?.stripe_customer_id ?? null) as string | null;
  if (!customerId) return;

  let subs: Stripe.ApiList<Stripe.Subscription>;
  try {
    subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
  } catch (err) {
    await reportServerError(err, {
      route: callerRoute,
      context: { userId, customerId, step: "stripe-list" },
    });
    return;
  }

  // Stripe rejects `cancel` on terminal statuses, so filter before
  // calling. The remaining statuses still imply billing intent.
  const terminal = new Set(["canceled", "incomplete_expired"]);
  for (const sub of subs.data) {
    if (terminal.has(sub.status)) continue;
    try {
      await stripe.subscriptions.cancel(sub.id, { prorate: false });
    } catch (err) {
      await reportServerError(err, {
        route: callerRoute,
        context: {
          userId,
          customerId,
          subscriptionId: sub.id,
          step: "stripe-cancel",
        },
      });
      // One sub failing shouldn't block the others, and shouldn't
      // block the auth.users delete that follows.
    }
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
