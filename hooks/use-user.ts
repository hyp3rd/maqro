"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import {
  isAuthRetryableFetchError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type UserState = {
  user: User | null;
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
 * and token refresh. Falls back to `{ user: null, isLoaded: true,
 * isUnconfigured: true }` when env vars are missing. */
export function useUser(): UserState {
  const supabase = getSupabaseBrowser();
  const isUnconfigured = supabase === null;
  const [user, setUser] = useState<User | null>(null);
  // `authResolved` is set true after the first async getUser() completes.
  // We don't reset it on unmount; React's strict-mode double-mount is
  // safe because the second mount will overwrite with the same value.
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    if (!supabase) return; // unconfigured — derived isLoaded is already true.

    let cancelled = false;

    resolveUser(supabase).then((resolved) => {
      if (cancelled) return;
      setUser(resolved);
      setAuthResolved(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      },
    );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  // Derived: unconfigured users skip loading entirely; configured users
  // wait for the first getUser() to resolve.
  const isLoaded = isUnconfigured || authResolved;

  return { user, isLoaded, isUnconfigured };
}
