import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AI_CAPS, resolveTier, type Tier } from "./tiers";

/** Read the user's complimentary (admin-granted) tier from `comp_grants`.
 *  Fail-CLOSED: any read error (RLS denial, table-missing during a partial
 *  deploy) returns "no comp", which is the same safe-side default as the rest
 *  of this module — a comped user briefly seeing free is recoverable, the
 *  reverse isn't. `comp_grants` is owner-readable, so this works with the
 *  caller's session client; the service-role client (admin routes) reads it
 *  too. */
async function readCompGrant(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tier: Tier | null; until: string | null }> {
  const { data } = await supabase
    .from("comp_grants")
    .select("tier, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    tier: (data?.tier as Tier | undefined) ?? null,
    until: (data?.expires_at as string | undefined) ?? null,
  };
}

/** Lightweight tier lookup for routes that only need the gating
 *  decision (no AI-quota arithmetic). Reads the same profile shape
 *  as `getCurrentMonthUsage` and routes through the same
 *  `resolveTier` so policy stays consistent. Returns `"free"` on
 *  any read error — fail-CLOSED for paid-feature gates is the
 *  right side to err on, since the worst case is a paying user
 *  briefly sees an upgrade prompt during a Supabase blip (recoverable
 *  by retry) vs the alternative of a free user slipping past the
 *  gate during the same blip. */
export async function loadUserTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<Tier> {
  const [{ data: profile }, comp] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "is_premium, role, subscription_status, stripe_price_id, is_grandfathered, grandfather_until",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    readCompGrant(supabase, userId),
  ]);
  return resolveTier({
    role: (profile?.role as string | undefined) ?? null,
    isPremium: (profile?.is_premium as boolean | undefined) ?? null,
    isGrandfathered: (profile?.is_grandfathered as boolean | undefined) ?? null,
    grandfatherUntil:
      (profile?.grandfather_until as string | undefined) ?? null,
    stripePriceId: (profile?.stripe_price_id as string | undefined) ?? null,
    subscriptionStatus:
      (profile?.subscription_status as string | undefined) ?? null,
    compTier: comp.tier,
    compUntil: comp.until,
  });
}

/** Monthly AI-call quota for free-tier users — kept exported for
 *  callers that need the raw value without doing tier resolution.
 *  See [AI_CAPS](./tiers.ts) for the per-tier table. */
export const FREE_AI_CAP_PER_MONTH = AI_CAPS.free ?? 25;

/** Result of {@link checkAndIncrementAiUsage}.
 *
 *  - `allowed: true` — cleared to call the model. Metered tiers have
 *    already been debited one credit for `debitedPeriod`; unmetered tiers
 *    (Pro) debit nothing and carry `debitedPeriod: null`.
 *  - `reason: "cap-reached"` — the month's cap is used up; reply 402.
 *  - `reason: "metering-unavailable"` — the debit could not be recorded
 *    (no service-role key, RPC or transport error, unexpected payload).
 *    Metering fails CLOSED: the route must not call the model. The failure
 *    has already been reported.
 *
 *  Routes turn a denial into a response with `aiUsageDeniedResponse`
 *  ([usage-response.ts](./usage-response.ts)). */
export type UsageCheckResult =
  | {
      allowed: true;
      tier: Tier;
      used: number;
      cap: number;
      debitedPeriod: string;
    }
  | { allowed: true; tier: Tier; used: null; cap: null; debitedPeriod: null }
  | {
      allowed: false;
      reason: "cap-reached";
      tier: Tier;
      used: number;
      cap: number;
    }
  | { allowed: false; reason: "metering-unavailable" };

export type UsageDenial = Extract<UsageCheckResult, { allowed: false }>;

/** Returns the first day of the current UTC month as `YYYY-MM-DD`,
 *  matching the `date` column type on `ai_usage_monthly.period_start`.
 *  Anchored to UTC so two devices on the same account in different
 *  timezones share a counter row. */
export function currentPeriodStart(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}-01`;
}

export type CurrentMonthUsage = {
  used: number;
  cap: number | null;
  /** Resolved C2 tier. The single signal callers should switch
   *  on for feature gating. */
  tier: Tier;
  /** Legacy boolean kept for backwards compat with C1 call sites.
   *  Equivalent to `tier !== "free"`. */
  isPremium: boolean;
  /** Stripe subscription status (`active`, `trialing`, `canceled`,
   *  etc.) — `null` when the user has never subscribed. */
  subscriptionStatus: string | null;
  /** ISO timestamp of when the current paid period ends — drives
   *  the "renews on X" / "cancels on X" copy in Settings. `null`
   *  for free users. */
  currentPeriodEnd: string | null;
};

/** Read-only check of the caller's current monthly usage AND
 *  subscription state. Single query path so the Settings page
 *  doesn't double-round-trip to get plan + usage. Returns `null`
 *  cap for premium users (unmetered). */
export async function getCurrentMonthUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<CurrentMonthUsage> {
  // Errors here are logged but not surfaced — the caller wants a
  // usage snapshot, not a failure mode. A missing table or RLS
  // denial here is a deploy-config bug (migration 0011 not applied /
  // wrong policy) and shows up in the server logs so it's actionable.
  // Read both the premium flag (Stripe-driven, lands when checkout
  // completes) AND the role (manual override for app managers / staff /
  // early supporters — migration 0012). Either being set means the
  // caller is unmetered; from the rest of the helper's POV it's a
  // single `isUnmetered` signal.
  const [{ data: profile, error: profileError }, comp] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "is_premium, role, subscription_status, current_period_end, stripe_price_id, is_grandfathered, grandfather_until",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    readCompGrant(supabase, userId),
  ]);
  if (profileError) {
    console.error("[ai-usage] profile read failed:", profileError);
  }
  const subscriptionStatus =
    (profile?.subscription_status as string | undefined) ?? null;
  const currentPeriodEnd =
    (profile?.current_period_end as string | undefined) ?? null;

  // Resolve the tier through the single-source-of-truth helper.
  // The `isPremium` boolean is derived from tier for backwards
  // compatibility with C1-era callers.
  const tier = resolveTier({
    role: (profile?.role as string | undefined) ?? null,
    isPremium: (profile?.is_premium as boolean | undefined) ?? null,
    isGrandfathered: (profile?.is_grandfathered as boolean | undefined) ?? null,
    grandfatherUntil:
      (profile?.grandfather_until as string | undefined) ?? null,
    stripePriceId: (profile?.stripe_price_id as string | undefined) ?? null,
    subscriptionStatus,
    compTier: comp.tier,
    compUntil: comp.until,
  });
  const isPremium = tier !== "free";
  const { data: usage, error: usageError } = await supabase
    .from("ai_usage_monthly")
    .select("count")
    .eq("user_id", userId)
    .eq("period_start", currentPeriodStart())
    .maybeSingle();
  if (usageError) {
    console.error("[ai-usage] usage read failed:", usageError);
  }
  const used = (usage?.count as number | undefined) ?? 0;
  return {
    used,
    cap: AI_CAPS[tier],
    tier,
    isPremium,
    subscriptionStatus,
    currentPeriodEnd,
  };
}

/** The RPC's single result row (migration 0080, `consume_ai_credit`). */
const ConsumeRow = z.object({
  granted: z.boolean(),
  used: z.number().int().nonnegative(),
});

/** Where metering failures land in `error_log`. Metering is shared by
 *  every AI route, so the route column names the subsystem; the failing
 *  step goes in the context bag. */
const METERING_REPORT_ROUTE = "(ai-usage metering)";

/** Service-role client for the metering RPCs. The counter is server-owned
 *  (migration 0080): end users can read their own row, but only the
 *  service role may execute `consume_ai_credit` / `refund_ai_credit`,
 *  because the cap is an RPC argument and must never be caller-controlled.
 *  `null` when the secret key isn't configured. */
function meteringClient(): SupabaseClient | null {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function reportMeteringFailure(
  step: "consume" | "refund",
  err: unknown,
  userId: string,
): Promise<void> {
  console.error(`[ai-usage] ${step} failed:`, err);
  await reportServerError(err, {
    route: METERING_REPORT_ROUTE,
    context: { step },
    userId,
  });
}

const MISSING_SECRET_KEY = "SUPABASE_SECRET_KEY is not configured";

/** Gate an AI call on the caller's monthly cap and debit one credit.
 *
 *    1. Resolve the tier from the caller's own profile / comp grant
 *       (session client, RLS-scoped). Unmetered tiers (Pro) return
 *       `allowed` without touching the counter.
 *    2. Debit through `consume_ai_credit` with the service-role client.
 *       The check and the increment are one SQL statement, so concurrent
 *       calls serialize on the counter row and can never pass the cap.
 *
 *  Call this only after authenticating the user: `userId` must be the id
 *  returned by `auth.getUser()`, because the service-role RPC trusts it.
 *
 *  Fails CLOSED. Any metering failure is reported and returned as
 *  `reason: "metering-unavailable"`; the route must refuse the AI call
 *  rather than run it unmetered. */
export async function checkAndIncrementAiUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<UsageCheckResult> {
  // Unmetered tiers (Pro, and any future unlimited tier) skip the
  // counter entirely: the row exists only for enforcement.
  const tier = await loadUserTier(supabase, userId);
  const cap = AI_CAPS[tier];
  if (cap === null) {
    return { allowed: true, tier, used: null, cap: null, debitedPeriod: null };
  }

  const admin = meteringClient();
  if (!admin) {
    await reportMeteringFailure(
      "consume",
      new Error(MISSING_SECRET_KEY),
      userId,
    );
    return { allowed: false, reason: "metering-unavailable" };
  }

  const periodStart = currentPeriodStart();
  let row: z.infer<typeof ConsumeRow>;
  try {
    const { data, error } = await admin
      .rpc("consume_ai_credit", {
        p_user_id: userId,
        p_period_start: periodStart,
        p_cap: cap,
      })
      .single();
    if (error) throw error;
    row = ConsumeRow.parse(data);
  } catch (err) {
    await reportMeteringFailure("consume", err, userId);
    return { allowed: false, reason: "metering-unavailable" };
  }

  if (!row.granted) {
    return { allowed: false, reason: "cap-reached", tier, used: row.used, cap };
  }
  return {
    allowed: true,
    tier,
    used: row.used,
    cap,
    debitedPeriod: periodStart,
  };
}

/** Give back the credit a {@link checkAndIncrementAiUsage} call debited,
 *  for a route that does not bill a model call that produced nothing
 *  (recipes/import-from-url falls back to JSON-LD). Pass the result's
 *  `debitedPeriod` so a call that straddles a month boundary refunds the
 *  month it was charged to.
 *
 *  A failed refund is reported, not thrown: the user still gets the
 *  fallback result, and the operator sees the lost credit in `error_log`. */
export async function refundAiUsage(
  userId: string,
  debitedPeriod: string,
): Promise<void> {
  const admin = meteringClient();
  if (!admin) {
    await reportMeteringFailure(
      "refund",
      new Error(MISSING_SECRET_KEY),
      userId,
    );
    return;
  }
  try {
    const { error } = await admin.rpc("refund_ai_credit", {
      p_user_id: userId,
      p_period_start: debitedPeriod,
    });
    if (error) throw error;
  } catch (err) {
    await reportMeteringFailure("refund", err, userId);
  }
}
