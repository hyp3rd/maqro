import { Footer } from "@/components/shell/Footer";
import { PageTopBar } from "@/components/shell/PageTopBar";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PricingClient } from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing - Maqro",
  description:
    "Free forever for the core macro calculator + planner. Paid plans unlock higher AI limits, cross-device sync, and engagement emails. 7-day trial, no card up front.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing - Maqro",
    description:
      "Free forever for the core macro calculator + planner. Paid plans unlock higher AI limits, cross-device sync, and engagement emails.",
    url: "/pricing",
    type: "website",
  },
};

/** Dedicated /pricing page. Distinct from the landing page's inline
 *  Pricing section in two ways:
 *
 *    1. **Full feature-comparison matrix** - every gated feature
 *       listed once with a per-tier value. The landing teaser shows
 *       four bullets per card; this page shows the whole grid so a
 *       prospect can answer "does Plan X include Y?" without
 *       guessing.
 *
 *    2. **Monthly / yearly toggle** - the landing teaser only shows
 *       the monthly rate to keep that section compact. Here we
 *       expose both so the discount math is visible (the toggle is
 *       client-side state; everything else is server-rendered).
 *
 *  Both surfaces share lib/billing/plans.ts so the names, prices,
 *  and tagline copy stay in sync. The matrix data lives only on
 *  this page (the teaser doesn't need it). */
export default async function PricingPage() {
  const t = await getTranslations("pageTopBar");
  return (
    <>
      <PageTopBar
        href="/"
        label={t("backToHome")}
      />
      <main className="mx-auto max-w-6xl px-safe-or-6 py-10 sm:py-14">
        <PricingClient />
      </main>
      <Footer />
    </>
  );
}
