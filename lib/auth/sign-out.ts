import {
  clearLastKnownUser,
  readLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { clearCachedTier, forgetCachedTier } from "@/lib/billing/tier-cache";
import { clearAllStores } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Forget the signed-out account's records kept outside IndexedDB — its
 *  cached tier and the last-known user — so the next user on this device is
 *  never shown as the previous one, and the signed-out account is not gated
 *  on a tier the server no longer vouches for. The account is the one the
 *  last-known record names (whose local data this device holds); other
 *  accounts' cached tiers stay, since each applies only to its own user.
 *  With no record, whose tier it is cannot be told, so every cached tier is
 *  forgotten. Used by sign-out and forced sign-out. Never throws (both
 *  records degrade to "absent" on storage errors). */
export function clearAccountRecords(): void {
  const userId = readLastKnownUserId();
  if (userId === null) clearCachedTier();
  else forgetCachedTier(userId);
  clearLastKnownUser();
}

/** Forget every account's records kept outside IndexedDB (device reset: the
 *  device is handed over, so nothing of any account may remain). Never
 *  throws. */
export function clearAllAccountRecords(): void {
  clearCachedTier();
  clearLastKnownUser();
}

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
  // Cleared here rather than left to the SIGNED_OUT event, which never
  // fires when `signOut()` can't load an expired session offline.
  clearAccountRecords();
  await supabase.auth.signOut();
}
