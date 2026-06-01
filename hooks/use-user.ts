"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export type UserState = {
  user: User | null;
  /** False before the auth client has resolved. */
  isLoaded: boolean;
  /** True if Supabase env vars aren't configured — the auth UI will be
   * disabled in that case but the rest of the app still works. */
  isUnconfigured: boolean;
};

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

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ?? null);
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
