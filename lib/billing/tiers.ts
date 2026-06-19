/** Single source of truth for the app's pricing tiers and the
 *  feature flags they unlock.
 *
 *  Every gating decision — "can this user sync?", "can this user
 *  receive a weekly recap email?" — funnels through this module so
 *  that adding a new tier or moving a feature is a one-place edit.
 *
 *  Tier resolution (admin short-circuits; otherwise the HIGHEST grant
 *  any signal justifies wins):
 *    0. `profiles.role = 'admin'`           → `pro` (staff / maintainer)
 *    1. `profiles.is_grandfathered = true`  → `pro` (existing users at C2 launch)
 *    2. `comp_grants` (admin comp)          → its tier (plus/pro)
 *    3. `profiles.stripe_price_id` matches `pro` price → `pro`
 *    4. `profiles.stripe_price_id` matches `plus` price → `plus`
 *    5. `profiles.is_premium = true` w/ no price ID → `plus` (legacy C1 customers)
 *    6. Otherwise → `free`
 *
 *  Modeling 1–5 as a MAX (rather than ordered early-returns) means a
 *  comp grant — or grandfather flag — can only ever RAISE a user's
 *  tier, never downgrade a higher paid subscription they also hold.
 *
 *  Why separate `is_grandfathered` / `comp_grants`: both grant a tier
 *  OUTSIDE Stripe. Without distinct signals we'd conflate "was here
 *  before the change" / "comped by an admin" with "paid", and a future
 *  billing migration could yank entitlement from those users. */
import { STRIPE_PRICES } from "./stripe";

export type Tier = "free" | "plus" | "pro";

/** Numeric ordering so callers can do `if (tier >= "plus")`-style
 *  checks without enumerating cases. */
const TIER_RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

export type TierResolutionInput = {
  role?: string | null;
  isPremium?: boolean | null;
  isGrandfathered?: boolean | null;
  /** When the grandfather grace period expires (ISO timestamp).
   *  resolveTier ignores `isGrandfathered` after this point so
   *  the flag stays on the row (for auditing) but stops granting
   *  privileges. */
  grandfatherUntil?: string | null;
  /** Stripe price ID from the active subscription. Used to
   *  distinguish Plus from Pro after C2 launches. */
  stripePriceId?: string | null;
  /** Stripe subscription status — only "entitled" statuses
   *  promote the user past free, even if a price ID is present. */
  subscriptionStatus?: string | null;
  /** Admin-granted complimentary tier from `comp_grants` (outside
   *  Stripe). Honors `compUntil` like the grandfather flag. */
  compTier?: Tier | null;
  /** When the comp grant expires (ISO). null = indefinite. */
  compUntil?: string | null;
  /** Override for tests. Date.now() at call time otherwise. */
  now?: Date;
};

const ENTITLED = new Set(["active", "trialing", "past_due"]);

export function resolveTier(input: TierResolutionInput): Tier {
  // Staff / maintainer override is absolute and outranks everything.
  if (input.role === "admin") return "pro";

  const now = input.now ?? new Date();
  // A grant with no expiry, or one still in the future, is active. A
  // missing expiry is honored (the launch/grant paths always set one when
  // they mean to time-box it; a null means "until revoked").
  const active = (until?: string | null): boolean =>
    !until || new Date(until).getTime() > now.getTime();

  // Collect every tier the signals justify; the highest wins. A max (not an
  // ordered early-return) guarantees a non-billing grant only ever raises
  // the tier — e.g. a comp Plus never downgrades a paid Pro.
  let best: Tier = "free";
  const consider = (t: Tier) => {
    if (TIER_RANK[t] > TIER_RANK[best]) best = t;
  };

  if (input.isGrandfathered === true && active(input.grandfatherUntil)) {
    consider("pro");
  }
  if (input.compTier && active(input.compUntil)) {
    consider(input.compTier);
  }

  const entitled =
    input.subscriptionStatus !== null &&
    input.subscriptionStatus !== undefined &&
    ENTITLED.has(input.subscriptionStatus);
  if (entitled && input.stripePriceId) {
    if (
      input.stripePriceId === STRIPE_PRICES.proMonthly() ||
      input.stripePriceId === STRIPE_PRICES.proYearly()
    ) {
      consider("pro");
    } else if (
      input.stripePriceId === STRIPE_PRICES.aiPlusMonthly() ||
      input.stripePriceId === STRIPE_PRICES.aiPlusYearly()
    ) {
      consider("plus");
    }
  }

  // Legacy path — pre-C2 customers have is_premium=true but no price ID we
  // can match against (the column didn't exist). Treat them as plus.
  if (input.isPremium === true) consider("plus");

  return best;
}

/** Per-tier monthly AI generation cap. `null` = unmetered. */
export const AI_CAPS: Record<Tier, number | null> = {
  free: 25,
  plus: 500,
  pro: null,
};

/** Feature gates — single import for any call site that needs to
 *  ask "is this allowed?". Centralizing here keeps the policy
 *  consistent between client UI and server enforcement (the
 *  server-side checks call the same predicates). */
export const FEATURES = {
  /** Cross-device sync via Supabase. Free users are local-only;
   *  paid plus users are also local-only (they pay for AI, not
   *  storage); pro users sync. */
  canSync: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Save / load full-record JSON to Supabase Storage. */
  canCloudExport: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Daily reminder + weekly recap email subscriptions. Free
   *  users can't subscribe; Plus can; Pro can. Note: this
   *  governs SUBSCRIPTION eligibility, not whether the cron is
   *  allowed to send (the cron also re-checks at send time so
   *  a downgrade stops the mail). */
  canSubscribeEmails: (tier: Tier) => tierAtLeast(tier, "plus"),
  /** Generate share URLs for recipes with custom (user-chosen)
   *  slugs. Pro only — the auto-generated slug path is
   *  available to everyone. */
  canCustomShareSlugs: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Import a recipe from a URL (and the supporting match-
   *  ingredients endpoint). Plus+ only. The route fetches arbitrary
   *  user-supplied URLs server-side — gating it on a paid tier
   *  shrinks the SSRF attack surface to users who've put a credit
   *  card on file, which materially raises the bar for abuse beyond
   *  what rate-limit + IP-range blocking can do alone. The existing
   *  defenses (validateUrl, DNS-pre-check, admin allowlist) all
   *  still apply on top. */
  canImportFromUrl: (tier: Tier) => tierAtLeast(tier, "plus"),
  /** Micronutrient enrichment + the vitamins/minerals report. Pro
   *  only — the background cron enriches food data from Open Food
   *  Facts and the report surfaces it for personal + medical-advisor
   *  use. Free/Plus users see an upgrade prompt where the report
   *  card would be. The enqueue + cron routes re-check this
   *  server-side so a downgrade stops the enrichment. */
  canTrackMicronutrients: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Goal-phase plans (cut → diet break → maintenance → lean bulk) that
   *  drive the calorie/macro target by date. Pro only — depth for the
   *  precise audience. Free/Plus users see an upgrade prompt where the
   *  planner would be, and their target stays on the single linear goal
   *  (the target injection re-checks the tier, so a downgrade reverts). */
  canUseGoalPhases: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Advanced adaptive-TDEE analytics: the maintenance-over-time chart and
   *  per-goal-phase maintenance reads on the Progress → Trends view. Pro only
   *  (the one-tap "use this as my TDEE" estimate itself stays free — this gates
   *  the historical chart + per-phase breakdown, the Pro-depth layer). */
  canViewTdeeHistory: (tier: Tier) => tierAtLeast(tier, "pro"),
  /** Hands-off weekly auto-adapt of the maintenance TDEE (the opt-in toggle +
   *  the weekly cron that applies small changes / holds large ones). Pro only;
   *  the cron re-checks this per user so a downgrade stops it. */
  canAutoAdaptTdee: (tier: Tier) => tierAtLeast(tier, "pro"),
};
