"use client";

import {
  clearLastKnownUser,
  readLastKnownUserId,
  writeLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { reportClientError } from "@/lib/error-reporter";
import {
  getSupabaseBrowser,
  readStoredSessionUserId,
} from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import {
  isAuthRetryableFetchError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type UserState = {
  /** The user of the session this device holds — `null` when signed out
   *  AND when offline-unverified. Anything that needs a real session (sync,
   *  AI calls, billing, account actions) keys off this. */
  user: User | null;
  /** Whose on-device data (day log, cached tier) to show: the session's
   *  user, or — offline-unverified — the last-known user; otherwise `null`.
   *  A selector for local data only: never a reason to call the server. */
  localUserId: string | null;
  /** True while the auth server can't be reached, no usable session exists
   *  (e.g. the access token expired offline), and `localUserId` comes from
   *  the on-device last-known record (lib/auth/last-known-user.ts). The
   *  identity is re-verified as soon as the network returns or the tab
   *  becomes visible. */
  isOfflineUnverified: boolean;
  /** False before the auth client has resolved. */
  isLoaded: boolean;
  /** True if Supabase env vars aren't configured — the auth UI will be
   * disabled in that case but the rest of the app still works. */
  isUnconfigured: boolean;
};

/** The signed-in user per the auth server, or — when the server can't be
 *  reached — per the locally persisted session.
 *
 *  `getUser()` validates the session against `/auth/v1/user`. Offline (common
 *  for this PWA) that request fails with an `AuthRetryableFetchError` and
 *  auth-js resolves `{ user: null }` — which is "couldn't ask", not "signed
 *  out": auth-js deliberately keeps the stored session on retryable failures
 *  and refreshes it once the network is back. Reporting `null` there would
 *  flip every signed-in surface to guest mode for the whole offline session
 *  (the cached Pro tier, the day log's identity, sync). So on a network
 *  failure we fall back to `getSession()`, which reads the persisted session
 *  without a network round-trip.
 *
 *  That identity is unverified, which is acceptable here: it only selects
 *  which local data / cached client-side gates to show on this device, and
 *  every server route re-authenticates the request itself. Any other error
 *  (missing or revoked session) still means signed out. */
async function resolveUser(supabase: SupabaseClient): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error === null || !isAuthRetryableFetchError(error)) {
    return data.user ?? null;
  }
  const { data: local } = await supabase.auth.getSession();
  return local.session?.user ?? null;
}

/** Subscribes to the Supabase auth session. Updates on sign-in, sign-out,
 * and token refresh, and re-checks an identity resolved from a network
 * failure when the browser comes back online or the tab becomes visible.
 * Falls back to `{ user: null, isLoaded: true, isUnconfigured: true }` when
 * env vars are missing. */
export function useUser(): UserState {
  const supabase = getSupabaseBrowser();
  const isUnconfigured = supabase === null;
  const [identity, setIdentity] = useState<Identity>(SIGNED_OUT);
  // `authResolved` is set true after the first async getUser() completes.
  // We don't reset it on unmount; React's strict-mode double-mount is
  // safe because the second mount will overwrite with the same value.
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    if (!supabase) return; // unconfigured — derived isLoaded is already true.

    let cancelled = false;
    // Whether the first resolution has landed: until then INITIAL_SESSION
    // (a read of local storage) supplies a provisional user; afterwards the
    // server-backed resolution supersedes it.
    let resolved = false;
    // Whether the current identity came from a failure (no network, or a
    // thrown check) and so must be re-verified once that could succeed.
    let unverified = false;
    // The user id the hook currently reports, or — offline-unverified — the
    // last-known one (`null` when none).
    let shownUserId: string | null = null;
    // The identity check in flight whose answer would still apply, if any.
    // Only that one may apply: an auth event that replaces the session it
    // was checking discards it (`inFlight = null`), so a late answer never
    // restores the identity the event replaced.
    let inFlight: Check | null = null;
    // The user id the server has vouched for, while that is the identity the
    // hook reports (`null` otherwise).
    let verifiedUserId: string | null = null;
    // The user id of the session the server last refused, until it accepts
    // one or the session is signed out. auth-js keeps a session that
    // `/auth/v1/user` refused as banned or deleted (it removes only a
    // missing one) and re-delivers it as SIGNED_IN on every tab focus.
    let refusedUserId: string | null = null;

    resolveUser(supabase).then((resolved) => {
      if (cancelled) return;
      setUser(resolved);
      setAuthResolved(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const user = session?.user ?? null;
        if (event === "INITIAL_SESSION") {
          // A read of the stored session: the one a check still waiting for
          // its subject is asking about.
          if (user !== null && inFlight?.subject === null) {
            inFlight.subject = user.id;
          }
          // Provisional only. Offline with an expired token it is `null`
          // although nothing signed the user out, so once `verify()` has
          // answered it must not override that answer.
          if (!resolved) show({ user, offlineUserId: null }, false);
          return;
        }
        // Any other event reflects the session auth-js holds now (sign-in,
        // refresh, sign-out — including a refresh the server rejected once
        // the network returned, or another tab signing out).
        const next: Identity = { user, offlineUserId: null };
        if (user === null || SERVER_ISSUED_EVENTS.has(event)) {
          // Signed out, or a session the server has just issued: final,
          // and newer than any check in flight, whose answer must then
          // never apply (it would restore the identity this replaced).
          inFlight = null;
          resolved = true;
          unverified = false;
          refusedUserId = null;
          syncLastKnownUser(next, true);
          show(next, true);
          setAuthResolved(true);
          return;
        }
        // A session that may come straight from storage: auth-js emits
        // SIGNED_IN from `_recoverAndRefresh` while it initializes — so on
        // every cold start, while the first check is in flight — and on
        // every tab focus, without asking the server. It is the current
        // session, but it says nothing about whether the server still
        // accepts it (a banned or deleted user's token stays valid until it
        // expires): it shows at once only provisionally — never written to
        // the last-known record — until a check answers for it.
        if (
          inFlight !== null &&
          (inFlight.subject === null || inFlight.subject === user.id)
        ) {
          // The check in flight is already asking about this session: it
          // decides. Asking again would only double the round trip.
          inFlight.subject = user.id;
          showUnverified(user);
          return;
        }
        if (inFlight === null && user.id === verifiedUserId) {
          // The verified session, re-delivered (tab focus, another tab).
          show(next, true);
          return;
        }
        // Otherwise the server's verdict on it is not known. A session of
        // another account than the one being checked discards that check,
        // and is checked in turn.
        showUnverified(user);
        verify(user.id);
      },
    );

    // Re-check an identity resolved from a failure once it could succeed.
    // Each runs once per browser event, so it cannot loop. While a check is
    // in flight (the tab's focus and auth-js's SIGNED_IN arrive together)
    // that check answers instead; should it fail again, it is repeated
    // once, so the event that may have restored the network isn't lost.
    // It asks about the identity the hook holds: the one it shows, or the
    // refused session it keeps hidden — so a refusal stays bound to it.
    const recheck = () => {
      if (!unverified) return;
      if (inFlight !== null) inFlight.retry = true;
      else verify(shownUserId ?? refusedUserId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [supabase]);

  // Derived: unconfigured users skip loading entirely; configured users
  // wait for the first getUser() to resolve.
  const isLoaded = isUnconfigured || authResolved;
  const { user, offlineUserId } = identity;

  return {
    user,
    localUserId: user?.id ?? offlineUserId,
    isOfflineUnverified: user === null && offlineUserId !== null,
    isLoaded,
    isUnconfigured,
  };
}
