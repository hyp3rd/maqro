"use client";

import { notifyServiceWorkerUpdate } from "@/lib/sw-update-bus";
import { useEffect } from "react";

/** Registers the app's service worker (`/sw.js`) on mount, then
 *  listens for the "an updated SW is installed and waiting" event
 *  so the [UpdateBanner](./UpdateBanner.tsx) can surface a prompt
 *  to the user.
 *
 *  Registration is disabled in development — a dev-mode SW would
 *  cache Turbopack's HMR chunks and make every "why isn't my
 *  change showing up?" debugging session worse than it needs to
 *  be. Production-only is the only safe stance.
 *
 *  Renders nothing. Side-effects only.
 *
 *  See [public/sw.js](../../public/sw.js) for the worker itself
 *  and [lib/sw-update-bus.ts](../../lib/sw-update-bus.ts) for the
 *  pub/sub that connects this provider to UpdateBanner. */
export function ServiceWorkerProvider() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    async function register() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // `updateViaCache: "none"` tells the browser to bypass
          // HTTP cache when fetching the SW script itself. Without
          // this, a CDN with stale-while-revalidate semantics
          // could pin clients to an outdated SW indefinitely.
          updateViaCache: "none",
        });
        if (cancelled) return;

        // Cover three states the SW lifecycle can land in:
        //   1. Already-waiting SW from a previous load → notify
        //      immediately.
        //   2. New SW installing right now → wait for it to reach
        //      "installed" state then notify.
        //   3. Future updates → "updatefound" event during the
        //      session.
        if (registration.waiting) {
          notifyServiceWorkerUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + an active controller = an UPDATE, not
            // the first install. First-install transitions to
            // "installed" then "activated" without a controlling
            // SW already in place; we skip the prompt there.
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              notifyServiceWorkerUpdate(installing);
            }
          });
        });

        // Once the new SW takes over (after the user clicks
        // Refresh → SKIP_WAITING → activation), reload so the
        // page picks up the fresh bundle.
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          // Guard against a reload loop when the very first SW
          // gains control on initial load — we only want to
          // reload when the controller was already set.
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      } catch (err) {
        // Registration failures are non-fatal: the app still
        // works, just without offline support. Log so we know
        // something's wrong without breaking the UI.
        console.error("[sw] registration failed:", err);
      }
    }

    let refreshing = false;
    register();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
