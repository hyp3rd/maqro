"use client";

import { Button } from "@/components/ui/button";
import { useAiUsage } from "@/hooks/use-ai-usage";
import { clientFetch } from "@/lib/auth/client-fetch";
import { useState } from "react";
import { BillingDetails } from "./BillingDetails";
import { UpgradeDialog } from "./UpgradeDialog";

function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Plan + subscription card: current tier, renewal/cancellation, the Stripe
 *  customer portal (manage / update payment), an upgrade CTA for free users,
 *  and in-app invoice history (`BillingDetails`) for premium customers. Lives
 *  on the Profile page behind the "Billing & subscription" tile. Renders
 *  nothing until usage/plan data resolves. */
export function BillingSection() {
  const { state, refresh } = useAiUsage();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  // Don't render anything until we have data. Loading state for a
  // tiny "Plan: …" line is more flicker than information.
  if (state.status !== "ok") return null;
  const { isPremium, subscriptionStatus, currentPeriodEnd } = state.data;

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await clientFetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        // 503 = Stripe not configured. Other errors propagate
        // to the user via alert; no toast available here without
        // additional imports.
        alert(data.error ?? "Couldn't open the billing portal.");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setPortalBusy(false);
    }
  }

  const renewalLabel = (() => {
    if (!currentPeriodEnd) return null;
    const formatted = formatDate(currentPeriodEnd);
    if (
      subscriptionStatus === "canceled" ||
      subscriptionStatus === "incomplete_expired"
    ) {
      return `Access ends ${formatted}`;
    }
    return `Renews ${formatted}`;
  })();

  const isPastDue = subscriptionStatus === "past_due";

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Billing</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your plan and subscription.
        </p>
      </header>
      {/* Past-due alert is the authoritative, non-dismissible view
       *  of the same signal that powers the AppShell banner. The
       *  banner can be silenced for the session; this one can't -
       *  if the user navigated here they're already engaging with
       *  the issue. */}
      {isPastDue && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-xs text-red-900 dark:text-red-200"
        >
          <p className="font-medium">Payment failed on the last attempt.</p>
          <p className="mt-1 leading-snug">
            Stripe is retrying your card on its usual schedule. Update your
            payment method below to avoid losing premium access if the retries
            don&apos;t succeed.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">
              {isPremium ? "AI Plus" : "Free"}
            </span>
            {subscriptionStatus && subscriptionStatus !== "active" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {subscriptionStatus.replace(/_/g, " ")}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isPremium
              ? (renewalLabel ?? "Active subscription.")
              : "Free tier - limited monthly AI generations."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isPremium ? (
            <Button
              type="button"
              variant={isPastDue ? "default" : "outline"}
              size="sm"
              onClick={openPortal}
              disabled={portalBusy}
            >
              {portalBusy
                ? "Opening…"
                : isPastDue
                  ? "Update payment"
                  : "Manage subscription"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade
            </Button>
          )}
        </div>
      </div>

      {/* In-app billing surface - next charge, cancel/resume,
       *  invoice history. Self-hides for users without a Stripe
       *  customer (free-tier never-paid) so the section stays
       *  clean for them. Plan switch + payment-method update
       *  still go to the Stripe Portal via the button above. */}
      {isPremium && <BillingDetails />}

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={(open) => {
          setUpgradeOpen(open);
          if (!open) refresh();
        }}
        reason="settings"
      />
    </section>
  );
}

export default BillingSection;
