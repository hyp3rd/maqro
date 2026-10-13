"use client";

import { useUser } from "@/hooks/use-user";
import { requestMfaChallenge } from "@/lib/auth/mfa-challenge-bus";
import {
  assertDataApiAssurance,
  MfaRequiredError,
} from "@/lib/auth/session-assurance";
import { clearDemoModeData } from "@/lib/demo-data";
import {
  watchForForcedSignOut,
  type ForcedSignOutHandle,
} from "@/lib/devices/forced-signout";
import { registerCurrentDevice } from "@/lib/devices/registry";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { triggerSync } from "@/lib/sync";
import {
  startRealtimeSubscription,
  type RealtimeHandle,
} from "@/lib/sync/realtime";
import { useEffect, useRef } from "react";

/** Headless component that owns two cross-device sync lifecycles:
 *
 *  1. **Initial sync on sign-in** - fires `triggerSync` exactly once
 *     per `(user_id)` transition. Subsequent renders for the same user
 *     are no-ops so navigation doesn't re-trigger.
 *
 *  2. **Realtime subscription** - after the initial sync succeeds,
 *     subscribes to Supabase Realtime on every synced table so
 *     server-side changes (typically from a peer device) flow into
 *     IDB and bump the data bus, which the hooks listen on. On
 *     reconnect after a network blip, we run a one-shot `triggerSync`
 *     to catch up on events missed during the gap.
 *
 *  Sign-out tears both down so the next sign-in starts fresh.
 *
 *  Second factor: none of this may reach the Data API while an MFA-enrolled
 *  session still owes its second factor — RLS rejects it (migration 0079).
 *  `triggerSync` refuses with `MfaRequiredError`, the chain re-asserts it
 *  before device registration / realtime (triggerSync returns `null` without
 *  checking when a sync is already running), and on that error we open the
 *  in-app two-step prompt. Verifying it re-issues the session, `useUser`
 *  emits a new user object, and this effect runs the chain again. */
export function SyncManager() {
  const { user, isLoaded } = useUser();
  const lastSyncedFor = useRef<string | null>(null);
  const realtimeRef = useRef<RealtimeHandle | null>(null);
  const forcedSignOutRef = useRef<ForcedSignOutHandle | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      lastSyncedFor.current = null;
      // Tear down the previous subscriptions on sign-out / account swap.
      realtimeRef.current?.unsubscribe();
      realtimeRef.current = null;
      forcedSignOutRef.current?.unsubscribe();
      forcedSignOutRef.current = null;
      return;
    }
    if (lastSyncedFor.current === user.id) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    lastSyncedFor.current = user.id;
    // Discard sample-data rows BEFORE the first sync. Without this,
    // a visitor who clicked "Try with sample data" on the landing
    // page and then signed in would have the demo rows pushed up
    // into their real Supabase account - and on subsequent loads
    // they'd see the demo "today" instead of their actual data
    // because demo dates can shadow older real ones. `clearDemo
    // ModeData` is a no-op when the DEMO_FLAG_KEY isn't set, so the
    // common path (sign-in without ever touching demo mode) pays
    // nothing.
    clearDemoModeData()
      .catch(() => {
        // Best-effort. If clearing fails the worst case is the user
        // sees demo rows mixed with real data; the next sync may
        // still push junk. We log and proceed because aborting the
        // sync chain entirely would be worse.
      })
      .then(() => triggerSync(supabase, user.id))
      .then(() => assertDataApiAssurance(supabase))
      .then(() => {
        // Register this device in user_devices. Runs after sync so a
        // first-ever sign-in has the user row in place (FK target).
        // Best-effort: a failure here just means the device won't
        // appear in Settings → Signed-in devices until the next
        // sync registers it; nothing user-blocking.
        void registerCurrentDevice(supabase).catch(() => {});

        // Subscribe to "I've been kicked" events - if a sibling
        // device disconnects this session from Settings, this watcher
        // wipes IDB + signs out locally so the data doesn't leak.
        forcedSignOutRef.current?.unsubscribe();
        forcedSignOutRef.current = watchForForcedSignOut(supabase, user.id);

        // Tear down any stale handle (e.g. lingering from a previous
        // user before the lastSyncedFor reset) then start fresh.
        realtimeRef.current?.unsubscribe();
        realtimeRef.current = startRealtimeSubscription(supabase, user.id, {
          onReconnect: () => {
            // Network came back - pull anything we missed. Errors are
            // surfaced via sync-status; we don't need to handle here.
            void triggerSync(supabase, user.id).catch(() => {});
          },
        });
      })
      .catch((err: unknown) => {
        // Clear the cache so a later retry actually runs. The error
        // has already been surfaced via sync-status by triggerSync().
        lastSyncedFor.current = null;
        if (err instanceof MfaRequiredError) {
          // Cancelled / dialog not mounted: stay unsynced; the next
          // navigation hits the proxy, which sends the user to /login.
          void requestMfaChallenge().catch(() => {});
        }
      });
  }, [user, isLoaded]);

  return null;
}
