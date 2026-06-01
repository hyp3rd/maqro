"use client";

import { PullToRefresh } from "@/components/gestures/PullToRefresh";
import { useUser } from "@/hooks/use-user";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { triggerSync } from "@/lib/sync";
import type { ReactNode } from "react";

/** Wraps the app's main scroll container so a pull-down anywhere in the
 *  app triggers a Supabase sync.
 *
 *  Why "pull = sync" rather than a per-view refetch: every view here is
 *  local-first and already reactive — it re-reads IndexedDB via
 *  `useDataRev` the moment data changes. So the only meaningful
 *  "refresh" is pulling the latest from the server, which updates IDB,
 *  which lights up whichever view is open. One handler, view-agnostic,
 *  and it sits at the single real scroll container (AppShell) instead
 *  of fighting nested scrolls inside each view.
 *
 *  Gated to signed-in users: a guest has no server to sync with (IDB is
 *  the source of truth and is already live), so the gesture is disabled
 *  and the container is a plain scroller. */
export function PullToSync({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { user } = useUser();

  async function onRefresh() {
    if (!user) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    // triggerSync owns its own status side-effects (the topbar pill
    // reflects syncing → synced) and swallows its own errors, so we
    // just await it for the pull indicator's duration.
    await triggerSync(supabase, user.id);
  }

  return (
    <PullToRefresh
      onRefresh={onRefresh}
      disabled={!user}
      className={className}
    >
      {children}
    </PullToRefresh>
  );
}
