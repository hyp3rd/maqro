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

/** An identity check in flight. */
type Check = {
  /** The user id of the session it asks about, as far as the hook knows:
   *  the identity it re-checks, or the session the first session event
   *  delivers (`null` until then). A session event for another account
   *  discards the check; one for this account leaves the verdict to it. */
  subject: string | null;
  /** A re-check was requested while it was in flight: repeat it once if it
   *  fails for lack of network again. */
  retry: boolean;
};

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

/** Keep the last-known record in step with an answer about the session.
 *  The record is the offline fallback's only identity, so only a session the
 *  server has `verified` records its user (an account switch replaces the
 *  previous one); a session it has not verified (resolved offline, say)
 *  and the offline-unverified state leave the record alone, and signed out
 *  clears it. */
function syncLastKnownUser(identity: Identity, verified: boolean): void {
  if (identity.user !== null) {
    if (verified) writeLastKnownUserId(identity.user.id);
  } else if (identity.offlineUserId === null) clearLastKnownUser();
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

    const show = (next: Identity, verified: boolean) => {
      shownUserId = next.user?.id ?? next.offlineUserId;
      verifiedUserId = verified ? (next.user?.id ?? null) : null;
      setIdentity(next);
    };

    /** Show a session the server has not vouched for: provisionally, and
     *  never one it has refused, which stays hidden (nothing keyed to the
     *  account, like sync, may start) until a check accepts it. */
    const showUnverified = (user: User) =>
      show(
        user.id === refusedUserId ? SIGNED_OUT : { user, offlineUserId: null },
        false,
      );

    /** Ask the server about the session auth-js holds, as the session of
     *  `subject` (`null` while that is not known yet: the first session
     *  event names it). */
    const verify = (subject: string | null) => {
      const check: Check = { subject, retry: false };
      inFlight = check;
      const isCurrent = () => !cancelled && inFlight === check;
      void resolveUser(supabase).then(
        ({ unverified: stale, ...next }) => {
          if (!isCurrent()) return;
          const answered = next.user?.id ?? null;
          if (
            answered !== null &&
            check.subject !== null &&
            answered !== check.subject
          ) {
            // The answer is about another account than the session this
            // check was told about. The check read the stored session at a
            // moment the hook can't see, so either may be the newer one:
            // ask once more, about whatever auth-js holds by then.
            verify(null);
            return;
          }
          inFlight = null;
          resolved = true;
          unverified = stale;
          if (!stale) refusedUserId = next.user === null ? check.subject : null;
          syncLastKnownUser(next, !stale);
          if (stale && next.user !== null) showUnverified(next.user);
          else show(next, !stale);
          setAuthResolved(true);
          if (stale && check.retry) verify(check.subject);
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
          inFlight = null;
          resolved = true;
          unverified = true;
          show(SIGNED_OUT, false);
          setAuthResolved(true);
          if (check.retry) verify(check.subject);
        },
      );
    };

    verify(null);

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
    const recheck = () => {
      if (!unverified) return;
      if (inFlight !== null) inFlight.retry = true;
      else verify(shownUserId);
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
