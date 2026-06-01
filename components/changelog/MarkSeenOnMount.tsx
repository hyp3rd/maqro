"use client";

import { CHANGELOG_SEEN_STORAGE_KEY } from "@/lib/changelog";
import { useEffect } from "react";

/** Side-effect-only component. Writes the latest changelog id to
 *  localStorage on mount so the in-app "what's new" indicator
 *  clears as soon as the user lands on /changelog. No render
 *  output — the visual cue is the dot in the Footer disappearing
 *  on the next render.
 *
 *  We don't try to be clever about "marked seen only if the user
 *  scrolled to the bottom" — visiting the page is enough intent.
 *  Anything more involved is theater. */
export function MarkSeenOnMount({ latestId }: { latestId: string }) {
  useEffect(() => {
    if (!latestId) return;
    try {
      window.localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, latestId);
      // Cross-tab sync: a `storage` event fires in other tabs so a
      // parallel-open app shell clears its indicator too.
      window.dispatchEvent(new StorageEvent("storage"));
    } catch {
      // localStorage can throw in Safari private mode + a few other
      // edge cases. The indicator just stays on for that user — not
      // a correctness issue.
    }
  }, [latestId]);
  return null;
}
