"use client";

/** Tiny pub/sub for "the persisted profile has changed". Components that
 * read the profile out of IndexedDB independently of `useProfile` (the
 * sidebar UserMenu, mainly) subscribe here so they re-fetch instead of
 * showing stale state until the next page navigation.
 *
 * This is intentionally separate from `sync-status` because it has nothing
 * to do with server sync - it fires whenever the local profile blob is
 * written, regardless of whether Supabase is configured. */

const subscribers = new Set<() => void>();

export function notifyProfileChanged(): void {
  for (const s of subscribers) s();
}

export function subscribeProfileChanged(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
