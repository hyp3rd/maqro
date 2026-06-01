"use client";

import { clearAllStores } from "@/lib/db";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getCurrentSessionId } from "./registry";

/** Subscribes to DELETE events on the user's `user_devices` rows so
 *  this browser can react immediately when ANOTHER device (or the
 *  user themselves from a third device) disconnects this session via
 *  Settings → Signed-in devices.
 *
 *  Flow on a forced disconnect:
 *    1. The disconnect API route deletes the target row from
 *       public.user_devices.
 *    2. Postgres emits a DELETE event over the `supabase_realtime`
 *       publication. Because the table has REPLICA IDENTITY FULL
 *       (see migration 0022) the payload carries the full old row,
 *       including `session_id`.
 *    3. This handler compares the deleted row's `session_id` against
 *       OUR own (from the access token's JWT). On match, we know
 *       this browser was the target: wipe IDB so local copies of
 *       the user's data don't linger, sign out at the auth layer,
 *       and hard-redirect to /login with a `?disconnected=1` flag
 *       the login page can read to show a one-liner banner.
 *
 *  Why a dedicated channel (rather than piggybacking on the existing
 *  sync realtime sub): the data-sync channels in `lib/sync/realtime.ts`
 *  handle table inserts/updates/deletes for the synced data tables.
 *  Device disconnect is a different domain — auth/lifecycle, not
 *  user-data — and bundling them would couple two unrelated
 *  unsubscribe paths. Keeping it separate lets SyncManager start/stop
 *  it on the same user transition without entangling the two
 *  modules' code or types. */
export type ForcedSignOutHandle = { unsubscribe: () => void };

export function watchForForcedSignOut(
  supabase: SupabaseClient,
  userId: string,
): ForcedSignOutHandle {
  let mySessionId: string | null = null;

  // Capture our own session_id once, asynchronously. If the JWT
  // can't be parsed (very old SDK) the comparison below will never
  // match, which is a safe failure mode — we just won't auto-sign-
  // out on disconnect, but the user's access token will still
  // expire within an hour and refresh will fail.
  void getCurrentSessionId(supabase).then((sid) => {
    mySessionId = sid;
  });

  const channel: RealtimeChannel = supabase
    .channel("device-forced-signout")
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "user_devices",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        // REPLICA IDENTITY FULL → payload.old is the full deleted row.
        const deleted = payload.old as { session_id?: string } | undefined;
        const deletedSid = deleted?.session_id;
        if (!deletedSid || !mySessionId || deletedSid !== mySessionId) return;

        void (async () => {
          // Order matters: wipe IDB first so a crash mid-flow can't
          // leave the user signed out locally with stale rows on
          // disk; then sign out (which clears the cookies), then
          // navigate hard. The hard nav guarantees the next request
          // sees the cleared cookies and mounts a fresh client.
          try {
            await clearAllStores();
          } catch {
            // Best-effort; sign-out + nav still proceed.
          }
          try {
            await supabase.auth.signOut();
          } catch {
            // Same — keep going.
          }
          window.location.assign("/login?disconnected=1");
        })();
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
