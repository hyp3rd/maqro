import type { Tier } from "./tiers";

/** Single source of truth for what a Tier *looks like* in marketing
 *  surfaces - name, tagline, monthly + yearly prices, headline
 *  features, CTA href. The legacy inline Pricing section on the
 *  landing page used to inline this data via i18n; the new /pricing
 *  comparison page needs the same data plus a feature-matrix view
 *  and an annual/monthly cycle toggle, so it's cleaner to keep both
 *  surfaces pulling from one place.
 *
 *  Pricing numbers stay in code (not i18n) because they're tied to
 *  Stripe configuration in lib/billing/stripe.ts and need to move
 *  together when prices change. The string labels around them
 *  (e.g. "per month", "billed yearly") stay translatable via the
 *  consumer's t() calls.
 *
 *  **All user-facing labels are translation KEYS, not literal
 *  English text.** The consumer resolves them through next-intl's
 *  `t()` against `pricingPage.*`. Adding a locale needs only a
 *  matching JSON block in `messages/<locale>.json` — no code
 *  changes in this module or in PricingClient. */

export type Cycle = "monthly" | "yearly";

export type PlanData = {
  tier: Tier;
  /** i18n key under `pricingPage.plans.<tier>.name`. */
  nameKey: string;
  /** i18n key under `pricingPage.plans.<tier>.tagline`. */
  taglineKey: string;
  /** Monthly price in euros. 0 for the free tier. */
  monthlyEur: number;
  /** Yearly price in euros - what Stripe charges for the year
   *  subscription. Free tier is 0. The card displays this as the
   *  effective monthly cost (`yearlyEur / 12`) so the comparison
   *  with the monthly plan is apples-to-apples. */
  yearlyEur: number;
  /** Headline bullets for the card view. Each entry is an i18n
   *  KEY under `pricingPage.plans.<tier>.features.<key>` — the
   *  comparison matrix below covers the full Free/Plus/Pro grid;
   *  these are the four-or-so bullets that fit on a card. */
  featureKeys: string[];
  /** i18n key under `pricingPage.plans.<tier>.cta`. */
  ctaKey: string;
  /** Highlight the card as the recommended plan. One per page. */
  recommended?: boolean;
};

export const PLANS: PlanData[] = [
  {
    tier: "free",
    nameKey: "name",
    taglineKey: "tagline",
    monthlyEur: 0,
    yearlyEur: 0,
    featureKeys: [
      "macroCalculator",
      "weightDailyHistory",
      "recipeBuilder",
      "aiGenerations25",
    ],
    ctaKey: "cta",
  },
  {
    tier: "plus",
    nameKey: "name",
    taglineKey: "tagline",
    monthlyEur: 5,
    // 20% off the monthly rate. Same discount applied across all
    // paid tiers so the toggle math reads consistently.
    yearlyEur: 48,
    featureKeys: [
      "everythingInFree",
      "aiGenerations500",
      "importRecipesUrl",
      "reminders",
      "priorityQueue",
    ],
    ctaKey: "cta",
    recommended: true,
  },
  {
    tier: "pro",
    nameKey: "name",
    taglineKey: "tagline",
    monthlyEur: 12,
    yearlyEur: 115,
    featureKeys: [
      "everythingInPlus",
      "aiGenerationsUnlimited",
      "micronutrientsGoalPhases",
      "syncDevices",
      "encryptedBackup",
      "healthReportPdf",
    ],
    ctaKey: "cta",
  },
];

/** Return monthly-displayable price for a plan in the chosen
 *  billing cycle. Yearly is shown as `yearlyEur / 12` so the
 *  side-by-side comparison reads cleanly - the actual Stripe
 *  invoice is the full yearly amount, called out separately. */
export function effectiveMonthly(plan: PlanData, cycle: Cycle): number {
  if (plan.monthlyEur === 0) return 0;
  return cycle === "yearly" ? plan.yearlyEur / 12 : plan.monthlyEur;
}

/** Percentage discount the yearly cycle offers vs paying monthly.
 *  Returns 0 for the free tier (no discount applies). */
export function yearlyDiscountPct(plan: PlanData): number {
  if (plan.monthlyEur === 0) return 0;
  const fullYearAtMonthlyRate = plan.monthlyEur * 12;
  if (fullYearAtMonthlyRate === 0) return 0;
  return Math.round((1 - plan.yearlyEur / fullYearAtMonthlyRate) * 100);
}

/** Absolute euros saved over a year by paying yearly instead of
 *  monthly. The percentage alone reads as abstract; the concrete
 *  "€12/yr" is the figure that actually moves the choice. Returns 0
 *  for the free tier or any plan with no real discount. */
export function yearlySavingsEur(plan: PlanData): number {
  if (plan.monthlyEur === 0) return 0;
  return Math.max(0, plan.monthlyEur * 12 - plan.yearlyEur);
}

/** Stable section keys for the feature-matrix grouping. The order
 *  here is the render order. Resolved via
 *  `pricingPage.matrix.sections.<key>` on the consumer side. */
export type MatrixSection =
  "core" | "aiFeatures" | "syncData" | "communication" | "support";

/** One row of the per-feature comparison matrix. Boolean means
 *  "yes/no"; string means a per-tier value to render verbatim
 *  ("25", "Unlimited", "Sample only"). */
export type FeatureMatrixRow = {
  section: MatrixSection;
  /** Translation key under `pricingPage.matrix.rows.<key>.label`. */
  rowKey: string;
  /** When true, the consumer also looks up
   *  `pricingPage.matrix.rows.<key>.detail` for a one-line clarifier.
   *  Skip lookup when false to avoid rendering an empty <p>. */
  hasDetail?: boolean;
  free: boolean | string;
  plus: boolean | string;
  pro: boolean | string;
};

export const FEATURE_MATRIX: FeatureMatrixRow[] = [
  // ── Core
  {
    section: "core",
    rowKey: "macroCalculator",
    free: true,
    plus: true,
    pro: true,
  },
  { section: "core", rowKey: "mealPlanner", free: true, plus: true, pro: true },
  {
    section: "core",
    rowKey: "weightHistory",
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "core",
    rowKey: "recipeBuilder",
    free: true,
    plus: true,
    pro: true,
  },
  { section: "core", rowKey: "trends", free: true, plus: true, pro: true },
  {
    section: "core",
    rowKey: "barcode",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "core",
    // The Free tier has access to this BUT each call counts toward
    // the 25 AI generations/month cap. The previous row collapsed
    // barcode + photo into one "Camera identify" line, which read
    // as "Free gets the whole thing" — misleading because photo ID
    // consumes the AI allowance and barcode doesn't.
    rowKey: "photoMealId",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "core",
    rowKey: "fasting",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },
  { section: "core", rowKey: "hydration", free: true, plus: true, pro: true },
  {
    section: "core",
    rowKey: "bodyVitals",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "core",
    rowKey: "goalPhases",
    hasDetail: true,
    free: false,
    plus: false,
    pro: true,
  },
  {
    section: "core",
    rowKey: "micronutrients",
    hasDetail: true,
    free: false,
    plus: false,
    pro: true,
  },

  // ── AI features
  {
    section: "aiFeatures",
    rowKey: "aiGenerations",
    hasDetail: true,
    free: "25",
    plus: "500",
    pro: "Unlimited",
  },
  {
    section: "aiFeatures",
    rowKey: "importRecipesUrl",
    hasDetail: true,
    free: false,
    plus: true,
    pro: true,
  },
  {
    section: "aiFeatures",
    rowKey: "priorityQueue",
    free: false,
    plus: true,
    pro: true,
  },

  // ── Sync & data
  {
    section: "syncData",
    rowKey: "localStorage",
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "syncData",
    rowKey: "syncDevices",
    free: false,
    plus: false,
    pro: true,
  },
  {
    section: "syncData",
    rowKey: "cloudBackup",
    free: false,
    plus: false,
    pro: true,
  },
  {
    section: "syncData",
    rowKey: "encryptedBackup",
    hasDetail: true,
    free: false,
    plus: false,
    pro: true,
  },
  {
    section: "syncData",
    rowKey: "healthReportPdf",
    hasDetail: true,
    free: false,
    plus: false,
    pro: true,
  },
  {
    section: "syncData",
    rowKey: "manualJsonExport",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },

  // ── Communication
  {
    section: "communication",
    rowKey: "dailyReminder",
    free: false,
    plus: true,
    pro: true,
  },
  {
    section: "communication",
    rowKey: "weeklyRecap",
    free: false,
    plus: true,
    pro: true,
  },
  {
    section: "communication",
    rowKey: "customRecipeSlugs",
    hasDetail: true,
    free: false,
    plus: false,
    pro: true,
  },

  // ── Support
  {
    section: "support",
    rowKey: "contactForm",
    free: true,
    plus: true,
    pro: true,
  },
  {
    section: "support",
    rowKey: "sourceGithub",
    hasDetail: true,
    free: true,
    plus: true,
    pro: true,
  },
];

/** Translatable values for the matrix cells that hold a string
 *  (not a boolean). Some cells are language-agnostic ("25",
 *  "500") and pass through; "Unlimited" is the only English
 *  word and gets translated via this lookup. Keys here match
 *  `pricingPage.matrix.values.*`. */
export const MATRIX_VALUE_KEYS: Record<string, string> = {
  Unlimited: "unlimited",
};
