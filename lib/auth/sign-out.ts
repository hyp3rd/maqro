import { clearCachedTier } from "@/lib/billing/tier-cache";
import { clearAllStores } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Sign out and wipe the local IndexedDB *before* tearing down the
 *  session, so a different user signing in on the same device starts
 *  with empty stores instead of inheriting the previous user's pantry,
 *  recipes, logs, profile, etc. The wipe-before-`signOut` order matches
 *  [forced-signout.ts](../devices/forced-signout.ts) — by the time any
 *  hook observes `!user`, IDB is already clean, so the next sync's
 *  pull writes the *new* user's rows into a known-empty store.
 *
 *  Errors during the wipe are swallowed: storage being unavailable (a
 *  private window with persistence blocked, an extension intercepting
 *  IDB) must not strand the user in a half-signed-out state. The auth
 *  call is the user-visible step; the wipe is best-effort defence. */
export async function signOutAndClearLocal(
  supabase: SupabaseClient,
): Promise<void> {
  await clearAllStores().catch(() => {});
  // The last-known tier is per-account state too: the next user on this
  // device must never be gated on it.
  clearCachedTier();
  await supabase.auth.signOut();
}
