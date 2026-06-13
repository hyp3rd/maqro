import { getStripe } from "@/lib/billing/stripe";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** GET /api/admin/users/[id] — single-user detail payload for the
 *  admin user drawer / detail page. Returns everything the
 *  operator needs to make a decision without round-tripping for
 *  each field:
 *
 *    - auth.users core (email, created_at, last_sign_in_at, banned_until)
 *    - profile (role, is_premium, subscription_status, traced)
 *    - subscription summary from Stripe (plan label, period end,
 *      cancel-at-period-end) — null when the user has no
 *      Stripe customer
 *    - recent admin actions targeting this user (last 10) for
 *      quick "what's already been done to them?" context
 *
 *  Returns 404 when the auth user doesn't exist. */

type UserDetail = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Supabase exposes this as the `banned_until` ISO string when
   *  a ban is active; absent / null otherwise. We expose it as
   *  `bannedUntil` so the UI can render "Banned · <until>" or
   *  treat it as a simple boolean. */
  bannedUntil: string | null;
  role: "user" | "admin";
  isPremium: boolean;
  subscriptionStatus: string | null;
  traced: boolean;
  subscription: {
    id: string;
    status: string;
    planLabel: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  /** Active complimentary (admin-granted) tier, if any. `expiresAt`
   *  null = indefinite. Drives the Membership card's grant/revoke UI. */
  comp: { tier: "plus" | "pro"; expiresAt: string | null } | null;
  /** Recent admin-audit-log rows targeting this user. Newest
   *  first, capped at 10 — the full history lives on the audit
   *  page, this is just the "is anything in flight" preview. */
  recentActions: Array<{
    id: string;
    created_at: string;
    action: string;
    admin_user_id: string;
    payload: Record<string, unknown> | null;
  }>;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const config = getSupabaseSecretConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // auth.users core — getUserById is the targeted lookup, much
  // cheaper than re-paging listUsers when we know the id.
  const { data: userData, error: userErr } =
    await admin.auth.admin.getUserById(id);
  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 });
  }
  const user = userData?.user;
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Profile row — role / billing / traced. May not exist on a
  // brand-new account (the profile is created on first save);
  // we fall back to sensible defaults.
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_premium, subscription_status, stripe_customer_id, traced")
    .eq("user_id", id)
    .maybeSingle();

  const customerId = profile?.stripe_customer_id as string | undefined;

  // Stripe summary — only when the user has a customer id.
  // Same shape as /api/billing/subscription returns to the
  // end-user UI, kept independent so this route doesn't share
  // code with the user-facing one (they have different access
  // models — service-role here vs cookie-session there).
  let subscription: UserDetail["subscription"] = null;
  if (customerId) {
    const stripe = getStripe();
    if (stripe) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 1,
          expand: ["data.items.data.price"],
        });
        const sub = subs.data[0];
        if (sub) {
          const firstItem = sub.items.data[0];
          const price = firstItem?.price;
          const periodEnd = firstItem?.current_period_end ?? 0;
          // Same label fallback ladder as /api/billing/subscription:
          // nickname → formatted amount + interval → price id.
          let planLabel = "unknown";
          if (price) {
            if (price.nickname) {
              planLabel = price.nickname;
            } else if (price.unit_amount != null && price.recurring) {
              planLabel = `${new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: price.currency.toUpperCase(),
              }).format(
                price.unit_amount / 100,
              )} / ${price.recurring.interval}`;
            } else {
              planLabel = price.id;
            }
          }
          subscription = {
            id: sub.id,
            status: sub.status,
            planLabel,
            currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          };
        }
      } catch {
        // Stripe outage / sub deleted out from under us — leave
        // null. The detail page renders "No subscription" and the
        // operator can investigate via the Stripe dashboard.
      }
    }
  }

  // Active comp grant (admin-granted tier outside Stripe). Service-role read
  // bypasses RLS. A grant whose `expires_at` is in the past is treated as
  // inactive — it stays in the table for audit but no longer entitles, so the
  // UI shouldn't present it as live.
  const { data: compRow } = await admin
    .from("comp_grants")
    .select("tier, expires_at")
    .eq("user_id", id)
    .maybeSingle();
  const compTier = compRow?.tier as "plus" | "pro" | undefined;
  const compExpiresAt = (compRow?.expires_at as string | undefined) ?? null;
  const compActive =
    compTier != null &&
    (compExpiresAt === null || new Date(compExpiresAt).getTime() > Date.now());
  const comp: UserDetail["comp"] = compActive
    ? { tier: compTier, expiresAt: compExpiresAt }
    : null;

  const { data: recentRows } = await admin
    .from("admin_audit_log")
    .select("id, created_at, action, admin_user_id, payload")
    .eq("target_user_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const detail: UserDetail = {
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at ?? null,
    bannedUntil:
      typeof (user as { banned_until?: string | null }).banned_until ===
      "string"
        ? ((user as { banned_until?: string | null }).banned_until ?? null)
        : null,
    role: ((profile?.role as string | undefined) ?? "user") as "user" | "admin",
    isPremium: (profile?.is_premium as boolean | undefined) ?? false,
    subscriptionStatus:
      (profile?.subscription_status as string | undefined) ?? null,
    traced: (profile?.traced as boolean | undefined) ?? false,
    subscription,
    comp,
    recentActions: (recentRows as UserDetail["recentActions"] | null) ?? [],
  };
  return NextResponse.json(detail);
}
