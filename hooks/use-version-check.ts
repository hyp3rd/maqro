"use client";

import { APP_VERSION } from "@/lib/version";
import { useEffect, useState } from "react";

/** How often to poll `/api/version` while the tab is visible. 10 min
 *  is a compromise: short enough that users find out within a
 *  reasonable window after a deploy, long enough that we're not
 *  hammering the route. Visibility-change events catch returning
 *  users sooner — usually that's when the polling delay matters
 *  least anyway. */
const POLL_INTERVAL_MS = 10 * 60_000;

/** Delay before the first poll after mount. Lets first paint /
 *  hydration finish without an extra request competing for the
 *  network. */
const INITIAL_DELAY_MS = 5_000;

/** Watches for new app deploys while the user has the tab open.
 *  Returns the *server's* version if it differs from the bundle the
 *  client is running, or null while they match.
 *
 *  Strategy: poll [/api/version](../app/api/version/route.ts) on a
 *  fixed cadence + on visibility-change (returning to the tab is
 *  the canonical "I might be stale" moment). Once a mismatch is
 *  detected, we keep returning that value — the consumer is
 *  expected to surface it once per session.
 *
 *  Failures (offline, transient 5xx) are swallowed silently. The
 *  next tick recovers; missing one poll cycle isn't worth a UI
 *  error. */
export function useVersionCheck(): { newVersion: string | null } {
  const [newVersion, setNewVersion] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (cancelled) return;
        if (
          typeof data.version === "string" &&
          data.version &&
          data.version !== APP_VERSION
        ) {
          setNewVersion(data.version);
        }
      } catch {
        // Offline or transient — silent. Next tick recovers.
      }
    }

    const initialTimer = setTimeout(check, INITIAL_DELAY_MS);
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { newVersion };
}
