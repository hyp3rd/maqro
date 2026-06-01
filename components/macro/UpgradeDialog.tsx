"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clientFetch } from "@/lib/auth/client-fetch";
import { useState } from "react";
import { Check, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";

type Interval = "month" | "year";
type Plan = "plus" | "pro";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional override for "why am I seeing this?" copy - shown
   *  when the dialog opens from the AI-cap paywall vs Settings's
   *  generic upgrade button. */
  reason?: "ai-cap" | "settings" | "sync" | "import";
  /** Pre-select a plan. The user can still toggle inside the
   *  dialog - this just sets the initial highlight. */
  defaultPlan?: Plan;
};

type PlanCopy = {
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyMonthlyEquivalent: number;
  yearlyTotal: number;
  features: string[];
};

const PLAN_COPY: Record<Plan, PlanCopy> = {
  plus: {
    name: "AI Plus",
    tagline: "Lift the AI cap. Cancel any time.",
    monthlyPrice: 5,
    yearlyMonthlyEquivalent: 4,
    yearlyTotal: 48,
    features: [
      "500 AI generations per month",
      "Meal plans, recipes, photo identification",
      "Priority API queue",
      "Cancel any time, keep what you generated",
    ],
  },
  pro: {
    name: "Pro",
    tagline: "Everything in AI Plus plus sync, cloud, and email.",
    monthlyPrice: 12,
    yearlyMonthlyEquivalent: 10,
    yearlyTotal: 120,
    features: [
      "Unlimited AI generations",
      "Sync across all your devices",
      "Cloud backups + JSON exports",
      "Daily reminders + weekly recap emails",
      "Custom recipe-share slugs",
      "Cancel any time",
    ],
  },
};

/** Upgrade prompt for either AI Plus or Pro. Shown when:
 *    - The user hits the free-tier AI cap → `reason="ai-cap"`
 *    - The user clicks Upgrade in Settings → `reason="settings"`
 *    - A Pro-gated feature shows a "Sync needs Pro" CTA → `reason="sync"`
 *
 *  Posts to [/api/billing/checkout](../../app/api/billing/checkout/route.ts)
 *  with `{ plan, interval }` and redirects to Stripe Checkout. */
export function UpgradeDialog({
  open,
  onOpenChange,
  reason = "settings",
  defaultPlan = "plus",
}: Props) {
  const [interval, setInterval] = useState<Interval>("month");
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [busy, setBusy] = useState(false);

  async function startCheckout() {
    setBusy(true);
    try {
      const res = await clientFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval, plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(
          data.error ?? "Couldn't start checkout. Try again in a moment.",
        );
        setBusy(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      toast.error("Network error. Try again.");
      setBusy(false);
    }
  }

  const copy = PLAN_COPY[plan];
  const yearly = interval === "year";
  const monthlyEquivalent = yearly
    ? copy.yearlyMonthlyEquivalent
    : copy.monthlyPrice;
  const billedAs = yearly
    ? `billed yearly at €${copy.yearlyTotal}`
    : "billed monthly";

  const reasonCopy =
    reason === "ai-cap"
      ? "You've used your free AI generations for the month. Upgrade to keep going."
      : reason === "sync"
        ? "Cross-device sync is part of Pro. Upgrade to enable it."
        : reason === "import"
          ? "Recipe import from URL is part of Plus and Pro. Upgrade to skip the manual entry."
          : "Lift the monthly limits. Cancel any time from Settings.";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-foreground" />
            Upgrade Maqro
          </DialogTitle>
          <DialogDescription>{reasonCopy}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Plan selector - Plus / Pro side-by-side. Selected
              card is foreground-bordered; unselected is muted. */}
          <div className="grid grid-cols-2 gap-2">
            <PlanCard
              plan="plus"
              selected={plan === "plus"}
              onClick={() => setPlan("plus")}
            />
            <PlanCard
              plan="pro"
              selected={plan === "pro"}
              onClick={() => setPlan("pro")}
            />
          </div>

          <div
            role="tablist"
            aria-label="Billing interval"
            className="inline-flex w-full rounded-lg border border-border/60 bg-muted/40 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={interval === "month"}
              onClick={() => setInterval("month")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                interval === "month"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={interval === "year"}
              onClick={() => setInterval("year")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                interval === "year"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Yearly
              <span className="ml-1.5 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                −20%
              </span>
            </button>
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">
                €{monthlyEquivalent.toFixed(2)}
              </span>
              <span className="text-sm text-muted-foreground">/ month</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{billedAs}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              7-day free trial - no card charged today.
            </p>

            <ul className="mt-4 space-y-2 text-sm">
              {copy.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                  <span className="text-foreground">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Payment processed by Stripe. Maqro never sees or stores card data.
            Manage or cancel from Settings → Billing at any time.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Not now
          </Button>
          <Button
            type="button"
            onClick={startCheckout}
            disabled={busy}
          >
            {busy ? "Redirecting…" : `Continue with ${copy.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  plan,
  selected,
  onClick,
}: {
  plan: Plan;
  selected: boolean;
  onClick: () => void;
}) {
  const copy = PLAN_COPY[plan];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
        selected
          ? "border-foreground/60 bg-accent/40"
          : "border-border/60 hover:bg-accent/20"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {plan === "pro" ? (
          <Zap className="h-3.5 w-3.5 text-foreground" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-foreground" />
        )}
        <span className="text-sm font-semibold tracking-tight">
          {copy.name}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {copy.tagline}
      </p>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        from €{copy.yearlyMonthlyEquivalent}/mo
      </p>
    </button>
  );
}
