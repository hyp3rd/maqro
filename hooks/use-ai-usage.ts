"use client";

import { useUser } from "@/hooks/use-user";
import type { Tier } from "@/lib/billing/tiers";
import { useCallback, useEffect, useState } from "react";

export type AiUsage = {
  used: number;
  /** `null` for unmetered tiers (Pro and beyond). */
  cap: number | null;
  /** Resolved C2 tier — the canonical signal for feature gating
   *  on the client. */
  tier: Tier;
  /** Legacy backwards-compat boolean for C1-era call sites.
   *  Equivalent to `tier !== "free"`. */
  isPremium: boolean;
  /** Stripe subscription status. `null` if the user has never
   *  subscribed. */
  subscriptionStatus?: string | null;
  /** ISO timestamp of the current paid-period end. `null` for
   *  free users. */
  currentPeriodEnd?: string | null;
};

export type AiUsageState =
  | { status: "loading" }
  | { status: "anon" } // not signed in — no usage to fetch
  | { status: "ok"; data: AiUsage }
  | { status: "error"; message: string };

export type UseAiUsageResult = {
  state: AiUsageState;
  /** Imperatively re-fetch (e.g. user clicks the "Refresh" button in
   *  Settings, or after an AI call lands a 200 OK and we want the
   *  counter to update without waiting for window-focus). */
  refresh: () => void;
};

/** Fetches the caller's current-month AI usage from
 *  `/api/billing/usage`. Returns `{ state, refresh }` so consumers
 *  can render the four states (loading / anon / ok / error) and
 *  trigger a manual re-fetch.
 *
 *  Auto-refresh hooks:
 *    - On mount (initial fetch)
 *    - Window focus (`visibilitychange` → if the tab becomes
 *      visible, re-fetch). Covers the common case where the user
 *      makes an AI call, switches back to Settings, and expects to
 *      see the bumped counter.
 *    - `refresh()` returned for explicit triggers. */
export function useAiUsage(): UseAiUsageResult {
  const { user, isLoaded } = useUser();
  const [state, setState] = useState<AiUsageState>({ status: "loading" });
  // `tick` is the load trigger — bumping it re-runs the effect.
  // Both window-focus refresh and the imperative refresh() function
  // route through it so the data path stays single.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Signed-out users have no usage to fetch — skip the auth-only endpoint
    // entirely rather than fire a guaranteed 401 at it. The "anon"/"loading"
    // gate states are derived below, so there's nothing to set here.
    if (!isLoaded || !user) return;
    let cancelled = false;
    fetch("/api/billing/usage")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          // Session expired mid-flight — fall back to anon.
          setState({ status: "anon" });
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            status: "error",
            message: data.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as AiUsage;
        setState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load usage.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tick, user, isLoaded]);

  // Refresh whenever the tab regains visibility. The user might have
  // been on the meal planner making AI calls, switched away, and is
  // now back looking at Settings — the counter should reflect what
  // just happened.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.visibilityState === "visible") {
        setTick((t) => t + 1);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Derive the gate states instead of setting them in the effect (a sync
  // setState there triggers cascading renders): a guest is "anon", an
  // unresolved session is "loading", otherwise the fetched state.
  const exposedState: AiUsageState = !isLoaded
    ? { status: "loading" }
    : !user
      ? { status: "anon" }
      : state;

  return { state: exposedState, refresh };
}
