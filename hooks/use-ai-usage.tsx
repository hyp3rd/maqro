"use client";

import { useUser } from "@/hooks/use-user";
import {
  forgetCachedTier,
  readCachedTier,
  writeCachedTier,
} from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

/** The tier to gate client-side features on.
 *
 *  - `tier`: the live server answer when there is one; the last
 *    server-confirmed tier for this user when the live request FAILED
 *    (offline, server error); otherwise `null` (still loading, signed out,
 *    or failed with nothing cached).
 *  - `resolved`: whether the gate decision is final enough to render an
 *    upgrade prompt — true once a tier is known or the user is signed out,
 *    false while loading (so a Pro user never sees a flash of the upsell). */
export type TierState = { tier: Tier | null; resolved: boolean };

/** Pure gate policy behind `useTier` — exported for direct tests. The cached
 *  tier is consulted ONLY when there is no live answer to be had (the
 *  request failed, or there is no session to make it with while
 *  offline-unverified), never in place of a live answer, so it can't grant
 *  more than the server last said. */
export function resolveTierState(
  state: AiUsageState,
  cachedTier: () => Tier | null,
): TierState {
  switch (state.status) {
    case "ok":
      return { tier: state.data.tier, resolved: true };
    case "anon":
      return { tier: null, resolved: true };
    case "loading":
      return { tier: null, resolved: false };
    case "error": {
      const cached = cachedTier();
      return cached === null
        ? { tier: null, resolved: false }
        : { tier: cached, resolved: true };
    }
  }
}

/** How long the usage request may take before it counts as failed. On a
 *  degraded network ("lie-fi") fetch can hang for minutes instead of
 *  rejecting; without a bound the state would sit at "loading" (tier
 *  `null`) and a Pro user would see their non-phase target the whole time.
 *  Timing out lands on the "error" path, where the cached tier applies. The
 *  endpoint is a single indexed read, so a healthy response is well inside
 *  this budget even on a cold start. */
export const USAGE_FETCH_TIMEOUT_MS = 8_000;

/** The usage state while offline-unverified (see `UserState`): no request is
 *  made, and the gate falls back to the cached tier as for a failed one. */
export const OFFLINE_UNVERIFIED_USAGE: AiUsageState = {
  status: "error",
  message: "You're offline. Usage loads once you're back online.",
};

type AiUsageContextValue = UseAiUsageResult & {
  tier: TierState;
  /** `refresh()` unless a request is already pending or in flight — a reader
   *  mounting then gets that request's (fresh) answer anyway. */
  refreshIfIdle: () => void;
};

const AiUsageContext = createContext<AiUsageContextValue | null>(null);

/** The ONE `/api/billing/usage` fetch for a subtree. Every usage/tier reader
 *  below it shares this state, so separate components can never disagree
 *  about the tier (each used to fetch on its own), and the last-known tier
 *  is persisted per user (lib/billing/tier-cache.ts) so an offline Pro user
 *  keeps their Pro-gated targets.
 *
 *  Offline-unverified (an expired session opened offline — see `UserState`)
 *  makes no request at all: the on-device record is not a credential, so
 *  nothing calls the server as that user. The cached tier applies until the
 *  session is verified again, which triggers the initial fetch.
 *
 *  Auto-refresh:
 *    - On mount / when the signed-in user changes (initial fetch)
 *    - When a live-usage reader (`useAiUsage`) mounts, e.g. opening Profile,
 *      unless a request is already in flight (`refreshIfIdle`)
 *    - After every successful AI call (`useRefreshAiUsage`), so the counter
 *      and the 80% near-cap warning reflect the debit
 *    - Window focus (`visibilitychange` → if the tab becomes visible,
 *      re-fetch), for usage spent on another device or tab
 *    - `refresh()` for explicit triggers.
 *
 *  Each request is bounded by `USAGE_FETCH_TIMEOUT_MS` and aborted when it is
 *  superseded (a newer refresh, a user switch) or the provider unmounts. */
export function AiUsageProvider({ children }: { children: ReactNode }) {
  // `localUserId`: the session's user, or the last-known one while
  // offline-unverified — whose cached tier applies.
  const { localUserId: userId, isOfflineUnverified, isLoaded } = useUser();
  // The settled response, tagged with the user it belongs to: after an
  // account switch the previous user's answer must never surface for the
  // new one while their own request is in flight.
  const [settled, setSettled] = useState<{
    userId: string;
    state: AiUsageState;
  } | null>(null);
  // `tick` is the load trigger — bumping it re-runs the effect.
  // Both window-focus refresh and the imperative refresh() function
  // route through it so the data path stays single.
  const [tick, setTick] = useState(0);

  // True from mount until the first request settles, and again whenever a
  // request is in flight: a usage reader mounting meanwhile needn't trigger
  // another fetch. It starts true because on first load the readers' mount
  // effects run before this provider's. Read only from callbacks.
  const requestPending = useRef(true);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  const refreshIfIdle = useCallback(() => {
    if (!requestPending.current) setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Signed-out users have no usage to fetch — skip the auth-only endpoint
    // entirely rather than fire a guaranteed 401 at it; offline-unverified
    // has no session to fetch with. The "anon"/"loading"/offline gate states
    // are derived below, so there's nothing to set here.
    if (!isLoaded || !userId || isOfflineUnverified) return;
    let cancelled = false;
    requestPending.current = true;
    // AbortController + timer rather than AbortSignal.timeout/any: `any` needs
    // Safari 17.4, above Next's default browser floor (Safari 16.4), and the
    // controller also cancels a superseded request on cleanup.
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            `Usage request timed out after ${USAGE_FETCH_TIMEOUT_MS / 1000}s.`,
            "TimeoutError",
          ),
        ),
      USAGE_FETCH_TIMEOUT_MS,
    );
    const settle = (state: AiUsageState) => {
      if (cancelled) return;
      clearTimeout(timeout);
      requestPending.current = false;
      setSettled({ userId, state });
    };
    fetch("/api/billing/usage", { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          // Session expired mid-flight — fall back to anon, and forget this
          // user's tier: the server no longer vouches for this session. It
          // says nothing about another account's entry.
          forgetCachedTier(userId);
          settle({ status: "anon" });
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          settle({
            status: "error",
            message: data.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as AiUsage;
        if (cancelled) return;
        writeCachedTier(userId, data.tier);
        settle({ status: "ok", data });
      })
      .catch((err: unknown) => {
        // A superseded request is aborted on cleanup and settles as a no-op
        // (`cancelled`); a timed-out one rejects with the TimeoutError above.
        settle({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load usage.",
        });
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [tick, userId, isLoaded, isOfflineUnverified]);

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
  // unresolved session is "loading", offline-unverified is the no-request
  // error state, a response for another user (or none yet) is "loading",
  // otherwise the settled state.
  const state: AiUsageState = useMemo(
    () =>
      !isLoaded
        ? { status: "loading" }
        : !userId
          ? { status: "anon" }
          : isOfflineUnverified
            ? OFFLINE_UNVERIFIED_USAGE
            : settled?.userId === userId
              ? settled.state
              : { status: "loading" },
    [isLoaded, userId, isOfflineUnverified, settled],
  );

  const value = useMemo<AiUsageContextValue>(
    () => ({
      state,
      refresh,
      refreshIfIdle,
      tier: resolveTierState(state, () =>
        userId ? readCachedTier(userId) : null,
      ),
    }),
    [state, refresh, refreshIfIdle, userId],
  );

  return <AiUsageContext value={value}>{children}</AiUsageContext>;
}

function useAiUsageContext(hook: string): AiUsageContextValue {
  const ctx = useContext(AiUsageContext);
  if (ctx === null) {
    throw new Error(`${hook} must be used inside <AiUsageProvider>.`);
  }
  return ctx;
}

/** The caller's current-month AI usage from the shared provider. Returns
 *  `{ state, refresh }` so consumers can render the four states (loading /
 *  anon / ok / error) and trigger a manual re-fetch. Live data only — for
 *  feature gating use `useTier`, which also survives an offline fetch.
 *
 *  Mounting a reader re-fetches the shared state (unless a request is
 *  already in flight), so the counter is current whenever it is shown —
 *  e.g. opening Profile after spending AI calls elsewhere in the app. */
export function useAiUsage(): UseAiUsageResult {
  const { state, refresh, refreshIfIdle } = useAiUsageContext("useAiUsage");
  useEffect(() => {
    refreshIfIdle();
  }, [refreshIfIdle]);
  return useMemo(() => ({ state, refresh }), [state, refresh]);
}

/** The shared `refresh()` for AI call sites: call it after an AI request
 *  returns 2xx, so every usage reader (counter, near-cap warning) reflects
 *  the call the server just debited. Unlike `useAiUsage`, this hook never
 *  fetches by itself. */
export function useRefreshAiUsage(): () => void {
  return useAiUsageContext("useRefreshAiUsage").refresh;
}

/** The tier to gate client-side features on (see `TierState`). */
export function useTier(): TierState {
  return useAiUsageContext("useTier").tier;
}
