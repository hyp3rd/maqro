"use client";

import { useVersionCheck } from "@/hooks/use-version-check";
import { subscribeServiceWorkerUpdate } from "@/lib/sw-update-bus";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Surfaces a sonner toast when an updated app version is available.
 *
 *  Two signal sources, one toast:
 *    1. **Service-worker `waiting` event** — fires immediately when
 *       the new SW finishes installing. The Refresh action
 *       postMessages SKIP_WAITING; the SW activates; the SW's
 *       `controllerchange` handler reloads the page.
 *    2. **`/api/version` polling** — works on browsers that don't
 *       support service workers, on the very first visit before
 *       the SW takes over, or when the SW registration failed. The
 *       Refresh action plain-reloads.
 *
 *  Both paths converge on the same single-toast-per-session
 *  policy via the `notified` ref.
 *
 *  Renders nothing — fires the toast as a side effect and bows
 *  out. Mounted in [AppShell.tsx](./AppShell.tsx). */
export function UpdateBanner() {
  const { newVersion } = useVersionCheck();
  // Use a ref instead of a state flag so a re-render from the
  // toast itself doesn't accidentally re-trigger the effect.
  const notified = useRef(false);

  // Source 1: service-worker waiting event.
  useEffect(() => {
    const unsub = subscribeServiceWorkerUpdate((waiting) => {
      if (notified.current) return;
      notified.current = true;
      toast.info("A new version is ready", {
        description: "Refresh to load the latest changes.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Refresh",
          onClick: () => {
            // Tell the waiting SW to take over. The SW provider's
            // `controllerchange` listener handles the reload once
            // the new SW is in control — so we don't reload here,
            // or we'd race against activation.
            waiting.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    });
    return unsub;
  }, []);

  // Source 2: version-poll fallback.
  useEffect(() => {
    if (!newVersion || notified.current) return;
    notified.current = true;
    toast.info(`A new version is ready (v${newVersion})`, {
      description: "Refresh to load the latest changes.",
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "Refresh",
        // Hard reload — no SW takeover available on this path.
        onClick: () => window.location.reload(),
      },
    });
  }, [newVersion]);

  return null;
}
