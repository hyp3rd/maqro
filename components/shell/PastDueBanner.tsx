"use client";

import { Button } from "@/components/ui/button";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { clientFetch } from "@/lib/auth/client-fetch";
import * as React from "react";
import { useSyncExternalStore } from "react";
import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

/** Slim "your payment failed" banner shown when the user's Stripe
 *  subscription is in `past_due`. Two surfaces consume the same
 *  signal:
 *
 *    - This banner (dismissible, session-scoped) - sits at the top
 *      of the AppShell so users notice without having to navigate
 *      to Settings.
 *    - The Settings → Billing alert (non-dismissible) - the
 *      authoritative source. Lives next to the rest of the
 *      subscription controls.
 *
 *  Why `past_due` and not `unpaid` / `canceled`: those terminal
 *  statuses no longer let Stripe auto-retry the card. They're
 *  represented as "expired" / "fully canceled" elsewhere and don't
 *  warrant a dunning prompt. `past_due` is the actionable window:
 *  Stripe is mid-retry, a card update from the user lets the next
 *  attempt succeed and lifts the status back to `active`.
 *
 *  Dismissal: stored in sessionStorage so it sticks for the tab's
 *  lifetime but reappears on a fresh session. Persisting in
 *  localStorage would hide a critical billing state for too long. */
const DISMISS_KEY = "maqro:past-due-banner:dismissed:v1";

/** Module-level subscriber set so a `dismiss()` call in this tab
 *  notifies every mounted banner (and useSyncExternalStore's
 *  internal change-detection) without relying on the
 *  cross-tab-only `storage` event, which doesn't fire for same-tab
 *  sessionStorage mutations.
 *
 *  Kept outside the component because `useSyncExternalStore`'s
 *  subscribe + getSnapshot functions must be stable references -
 *  recreating them on every render makes React resubscribe each
 *  render and triggers the "Maximum update depth" loop (which we
 *  hit earlier in SignedInDevicesSection's clock ticker - same
 *  shape of bug). */
const dismissalSubscribers = new Set<() => void>();
function subscribeDismissed(notify: () => void): () => void {
  dismissalSubscribers.add(notify);
  return () => {
    dismissalSubscribers.delete(notify);
  };
}
function notifyDismissalChange(): void {
  for (const cb of dismissalSubscribers) cb();
}
function getDismissedSnapshot(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function getDismissedServerSnapshot(): boolean {
  return false;
}

export function PastDueBanner() {
  const status = useSubscriptionStatus();
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  );
  const [portalBusy, setPortalBusy] = React.useState(false);

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // No-op - sessionStorage blocked. The notification below
      // still fires so any in-memory mount re-reads (will return
      // false, banner stays visible - safer default for billing).
    }
    notifyDismissalChange();
  }

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await clientFetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        toast.error(
          body.error ?? "Couldn't open the billing portal. Please try again.",
        );
        return;
      }
      window.location.assign(body.url);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setPortalBusy(false);
    }
  }

  const visible =
    !dismissed && status.kind === "known" && status.status === "past_due";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="overflow-hidden border-b border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200"
          role="alert"
        >
          <div className="mx-auto flex max-w-6xl items-start gap-3 px-6 py-2.5 text-xs">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden
            />
            <p className="flex-1 leading-snug">
              <span className="font-medium">Payment failed.</span> Stripe is
              retrying your card; update your payment method to avoid losing
              premium access.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPortal}
              disabled={portalBusy}
              className="h-7 shrink-0 border-red-500/40 text-red-900 hover:bg-red-500/20 hover:text-red-900 dark:text-red-200 dark:hover:text-red-200"
            >
              {portalBusy ? "Opening…" : "Update payment"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-red-900 hover:bg-red-500/20 hover:text-red-900 dark:text-red-200 dark:hover:text-red-200"
              onClick={dismiss}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
