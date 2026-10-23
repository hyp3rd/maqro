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
  type AuthChangeEvent,
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

/** What the hook currently reports. `offlineUserId` is set only in the
 *  offline-unverified state, where `user` is `null`. */
type Identity = { user: User | null; offlineUserId: string | null };

type Resolution = Identity & {
  /** The answer came from a network failure rather than the server, so it
   *  must be checked again once the network is back. */
  unverified: boolean;
};

const SIGNED_OUT: Identity = { user: null, offlineUserId: null };

/** The signed-in user per the auth server, or — when the server can't be
 *  reached — per the locally persisted session, or failing that the
 *  last-known user.
 *
 *  `getUser()` validates the session against `/auth/v1/user`. Offline (common
 *  for this PWA) that request fails with an `AuthRetryableFetchError` and
 *  auth-js resolves `{ user: null }` — which is "couldn't ask", not "signed
 *  out": auth-js deliberately keeps the stored session on retryable failures
 *  and refreshes it once the network is back. Reporting `null` there would
 *  flip every signed-in surface to guest mode for the whole offline session
 *  (the cached Pro tier, the day log's identity). So on a network failure we
 *  fall back to `getSession()`, which reads the persisted session.
 *
 *  When the access token has also expired, `getSession()` needs a refresh
 *  that can't happen offline: it reports no session, with the same retryable
 *  error. Only then is the last-known record used — as `offlineUserId`, with
 *  `user` left `null`, because there is no token to act on — and only when
 *  it names the user of that stored session (`matchingLastKnownUserId`).
 *
 *  Any other outcome (no stored session, a missing or revoked one) is a
 *  definite "signed out". */
async function resolveUser(supabase: SupabaseClient): Promise<Resolution> {
  const { data, error } = await supabase.auth.getUser();
  if (error === null || !isAuthRetryableFetchError(error)) {
    return { user: data.user ?? null, offlineUserId: null, unverified: false };
  }
  const { data: local, error: localError } = await supabase.auth.getSession();
  if (local.session !== null) {
    return { user: local.session.user, offlineUserId: null, unverified: true };
  }
  if (localError !== null && isAuthRetryableFetchError(localError)) {
    return {
      user: null,
      offlineUserId: await matchingLastKnownUserId(),
      unverified: true,
    };
  }
  return { ...SIGNED_OUT, unverified: false };
}

/** The last-known record, if it names the user of the session auth-js keeps
 *  in storage (read without a refresh, so also when it has expired);
 *  otherwise `null`, and the caller's signed-out answer then clears the
 *  record (`syncLastKnownUser`).
 *
 *  The record can be stale: during a service-worker rollover an older
 *  bundle — which doesn't maintain the record — can sign out and sign in as
 *  another account, leaving the record naming the previous one. Showing
 *  that account's data for the new session would be wrong, so a record that
 *  doesn't match is never used. With no readable stored session there is
 *  nothing it can be checked against, so it isn't used either (the session
 *  may just have been signed out, e.g. in another tab). */
async function matchingLastKnownUserId(): Promise<string | null> {
  const recorded = readLastKnownUserId();
  if (recorded === null) return null;
  return (await readStoredSessionUserId()) === recorded ? recorded : null;
}

/** Keep the last-known record in step with what the hook reports: a session
 *  records its user (an account switch replaces the previous one), the
 *  offline-unverified state leaves it alone, and signed out clears it. */
function syncLastKnownUser(identity: Identity): void {
  if (identity.user !== null) writeLastKnownUserId(identity.user.id);
  else if (identity.offlineUserId === null) clearLastKnownUser();
}

/** Auth events whose session auth-js has just obtained from the auth server
 *  (a refresh-token grant, a user update): applying one verifies it. Every
 *  other session event can come from storage — notably SIGNED_IN, which
 *  auth-js's `_recoverAndRefresh` emits with the stored session while the
 *  client initializes and whenever the tab becomes visible, without asking
 *  the server. */
const SERVER_ISSUED_EVENTS: ReadonlySet<AuthChangeEvent> = new Set([
  "TOKEN_REFRESHED",
  "USER_UPDATED",
]);

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
    // Whether a `verify()` is in flight whose answer would still apply.
    let checking = false;
    // The user id the hook currently reports (`null` when none).
    let shownUserId: string | null = null;
    // Only the latest resolution may apply: an `online` re-check can overlap
    // the initial one, and an auth event supersedes any still in flight.
    let latestResolution = 0;

    const show = (next: Identity) => {
      shownUserId = next.user?.id ?? null;
      setIdentity(next);
    };

    const apply = (next: Identity) => {
      syncLastKnownUser(next);
      show(next);
    };

    const verify = () => {
      const run = ++latestResolution;
      checking = true;
      const isCurrent = () => !cancelled && run === latestResolution;
      void resolveUser(supabase).then(
        ({ unverified: stale, ...next }) => {
          if (!isCurrent()) return;
          checking = false;
          resolved = true;
          unverified = stale;
          apply(next);
          setAuthResolved(true);
        },
        (err: unknown) => {
          // getUser()/getSession() threw instead of returning an error
          // (e.g. the session storage itself failed). Report it, and
          // settle on the safest state: no identity at all — nothing keyed
          // to an account runs or shows. The last-known record is left
          // alone, since nothing says the session is gone, and the
          // identity is checked again when the network returns or the tab
          // becomes visible.
          reportClientError(err, {
            context: { source: "useUser.resolveUser" },
          });
          if (!isCurrent()) return;
          checking = false;
          resolved = true;
          unverified = true;
          show(SIGNED_OUT);
          setAuthResolved(true);
        },
      );
    };

    verify();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "INITIAL_SESSION") {
          // Provisional only. Offline with an expired token it is `null`
          // although nothing signed the user out, so once `verify()` has
          // answered it must not override that answer.
          if (!resolved)
            show({ user: session?.user ?? null, offlineUserId: null });
          return;
        }
        // Any other event reflects the session auth-js holds now (sign-in,
        // refresh, sign-out — including a refresh the server rejected once
        // the network returned, or another tab signing out). It is newer
        // than any `verify()` still in flight, whose answer must then never
        // apply (it would restore the identity this event replaced), so it
        // takes the next generation.
        latestResolution++;
        const superseded = checking;
        checking = false;
        const next: Identity = {
          user: session?.user ?? null,
          offlineUserId: null,
        };
        if (next.user === null || SERVER_ISSUED_EVENTS.has(event)) {
          // Signed out, or a session the server has just issued: final.
          resolved = true;
          unverified = false;
          apply(next);
          setAuthResolved(true);
          return;
        }
        // A session that may come straight from storage. It is the current
        // one, so it shows at once (provisionally until the first answer),
        // but it says nothing about whether the server still accepts it
        // (a banned or deleted user's token stays valid until it expires).
        // So whenever the server's verdict on it is not already known — a
        // check was in flight, the identity is unverified, or the session
        // is not the user the hook reports — the current session is
        // verified again.
        const known =
          resolved &&
          !superseded &&
          !unverified &&
          next.user.id === shownUserId;
        if (resolved) apply(next);
        else show(next);
        if (!known) verify();
      },
    );

    // Re-check an identity resolved from a failure once it could succeed.
    // Each runs once per browser event, so it cannot loop.
    const recheck = () => {
      if (unverified) verify();
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
