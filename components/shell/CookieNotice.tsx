"use client";

import { Button } from "@/components/ui/button";
import { useSyncExternalStore } from "react";
import { Cookie, X } from "lucide-react";
import Link from "next/link";

/** Cookie/privacy notice banner.
 *
 *  Legal posture: this app explicitly does NOT run analytics,
 *  advertising, or third-party tracking (see /privacy + the README
 *  "no analytics" promise). The only cookies in play are strictly-
 *  necessary ones — Supabase auth session cookies and Stripe's
 *  checkout-flow cookies during billing. Under GDPR/ePrivacy,
 *  strictly-necessary cookies do NOT require active consent; an
 *  informational notice is the legally-correct posture.
 *
 *  That's what this is: an informational notice, dismissible with
 *  "Got it". No accept/reject split, no granular toggles — there's
 *  nothing optional to consent to. Adding an Accept/Reject UI here
 *  would be dark-pattern theater that implies tracking the app
 *  doesn't actually do.
 *
 *  Dismissal stored in localStorage so the banner doesn't reappear
 *  on every visit. Per-device, not per-user — sufficient for an
 *  informational notice; if the project ever adds non-essential
 *  cookies, this should be replaced with a real consent surface
 *  tied to a server-side preference. */

const STORAGE_KEY = "maqro:cookie-notice-ack-v1";

function getAckSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari private mode / blocked storage — show the banner
    // anyway so the user gets the info; they can dismiss it but
    // we won't remember. Acceptable degradation.
    return null;
  }
}

function getAckServerSnapshot(): string | null {
  // The server has no idea about the per-device acknowledgment.
  // Return the "acknowledged" sentinel so the SSR pass renders the
  // banner HIDDEN — the alternative (showing it during SSR) causes
  // a hydration flash and a layout shift on every page load.
  // Real first-visit users will see the banner the moment the
  // client hydrates and the snapshot flips to null.
  return "ssr-hidden";
}

function subscribeAck(callback: () => void): () => void {
  // The "storage" event fires when ANOTHER tab updates localStorage.
  // The "got-it" dismissal happens in this tab and is reflected by a
  // forced re-render via the dispatched event we fire ourselves.
  window.addEventListener("storage", callback);
  window.addEventListener("maqro:cookie-notice-ack", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("maqro:cookie-notice-ack", callback);
  };
}

export function CookieNotice() {
  const ack = useSyncExternalStore(
    subscribeAck,
    getAckSnapshot,
    getAckServerSnapshot,
  );
  if (ack !== null) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage blocked — the banner will re-appear next visit.
      // Nothing we can do; logging would be noise.
    }
    // Force a re-read by every CookieNotice instance currently mounted
    // (there's only one in practice, but the event-bus pattern is
    // cheap and keeps the architecture honest if a second is ever
    // added).
    window.dispatchEvent(new Event("maqro:cookie-notice-ack"));
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-2 bottom-2 z-50 mx-auto max-w-2xl rounded-lg border border-border bg-card/95 px-4 py-3 text-xs shadow-lg backdrop-blur-sm sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      <div className="flex items-start gap-3">
        <Cookie
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="flex-1 leading-relaxed text-foreground/85">
          Maqro uses{" "}
          <span className="font-medium text-foreground">
            essential cookies only
          </span>{" "}
          — your sign-in session and Stripe&apos;s checkout flow. No analytics,
          no tracking, no ads.{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Read the privacy policy
          </Link>
          .
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={dismiss}
            className="h-7 text-[11px]"
          >
            Got it
          </Button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
            aria-label="Dismiss cookie notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
