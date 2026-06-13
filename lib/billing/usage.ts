import type { SupabaseClient } from "@supabase/supabase-js";
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

/** Result of a usage check. `allowed = true` means the call is
 *  cleared to proceed (and was already counted toward the user's
 *  quota); `allowed = false` means the route must reject with 402. */
export type UsageCheckResult =
  | {
      allowed: true;
      tier: Tier;
      isPremium: boolean;
      used: number;
      cap: number | null;
    }
  | {
      allowed: false;
      tier: "free" | "plus";
      isPremium: false;
      used: number;
      cap: number;
    };

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

/** Gate an AI route on the free-tier monthly cap. Pre-flight:
 *
 *    1. Read profile.is_premium — premium users are unmetered.
 *    2. Read current month's count — free users get `FREE_AI_CAP_PER_MONTH` per month.
 *    3. If under cap, upsert the count + 1 and return `allowed: true`.
 *    4. If at/over cap, return `allowed: false` with the values the
 *       client needs to render the paywall message.
 *
 *  Not strictly atomic — two concurrent calls in the tiny window
 *  between read and write could both pass and push the count
 *  slightly over. The cap is a soft business rule and small
 *  over-runs (one or two calls) cost cents at worst; we accept the
 *  race for the much simpler implementation. If exact-cap
 *  enforcement matters later, swap this for a SECURITY DEFINER
 *  Postgres function doing the upsert in a single transaction. */
/** Bump the user's monthly AI usage counter by one. Pass the
 *  `currentUsed` you read just before deciding to fire the model call
 *  — the count is computed as `currentUsed + 1` so this stays plain
 *  PostgREST (no custom RPC for `count = count + 1`). Use this when
 *  you've already checked the cap via {@link getCurrentMonthUsage}
 *  and want to defer the debit until *after* the AI vendor call
 *  actually succeeds — that way a vendor error (which falls back to
 *  a non-AI result path) doesn't burn the caller's credit. Failure
 *  is logged but not surfaced; the user shouldn't be punished for a
 *  bookkeeping outage. */
export async function incrementAiUsage(
  supabase: SupabaseClient,
  userId: string,
  currentUsed: number,
): Promise<void> {
  const periodStart = currentPeriodStart();
  const { error } = await supabase
    .from("ai_usage_monthly")
    .upsert(
      {
        user_id: userId,
        period_start: periodStart,
        count: currentUsed + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_start" },
    );
  if (error) {
    console.error("[ai-usage] increment failed:", error);
  }
}

export async function checkAndIncrementAiUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<UsageCheckResult> {
  const { used, cap, tier, isPremium } = await getCurrentMonthUsage(
    supabase,
    userId,
  );

  // Unmetered tiers (Pro, and any future unlimited tier) skip the
  // counter entirely. We could still track usage for product
  // analytics, but the row's only purpose here is enforcement —
  // and that doesn't apply.
  if (cap === null) {
    return { allowed: true, tier, isPremium, used, cap: null };
  }

  if (used >= cap) {
    // Narrow tier for the rejection path — only `free` and `plus`
    // can hit a cap (`pro` is unmetered). The cast is safe because
    // we just established cap !== null.
    return {
      allowed: false,
      tier: tier as "free" | "plus",
      isPremium: false,
      used,
      cap,
    };
  }

  // Increment via upsert so the first call of the month creates
  // the row and subsequent calls bump the counter. The `count`
  // value is computed from the just-read `used` rather than relying
  // on a Postgres-side increment expression so this stays plain
  // PostgREST without a custom RPC.
  const periodStart = currentPeriodStart();
  const { error: upsertError } = await supabase
    .from("ai_usage_monthly")
    .upsert(
      {
        user_id: userId,
        period_start: periodStart,
        count: used + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_start" },
    );
  if (upsertError) {
    // Log loud so the operator catches it in the route handler's
    // server logs. We still ALLOW the call rather than block on
    // metering infra — the user shouldn't be punished by our
    // bookkeeping outage. Downside: a real outage = unmetered AI
    // until it's fixed. Acceptable cost given the alternative
    // (blocking every user when ai_usage_monthly hiccups).
    console.error("[ai-usage] increment failed:", upsertError);
  }

  return { allowed: true, tier, isPremium, used: used + 1, cap };
}
