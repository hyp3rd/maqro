"use client";

import type { PersonalInfo } from "@/components/macro/types";
import { getProfile } from "@/lib/db";
import { subscribeProfileChanged } from "@/lib/profile-bus";
import { useEffect, useState } from "react";

/** Reads `displayName` from the local IndexedDB profile and
 *  re-renders subscribers when the profile bus emits an update
 *  (the same channel `PersonalInfoForm` writes to on save).
 *
 *  Why a dedicated hook instead of `useProfile().profile.displayName`:
 *  `useProfile` owns a debounced WRITE loop and is intended for the
 *  single screen that edits the profile. The Settings sections only
 *  want a read; coupling a dozen leaf components to the write loop
 *  would multiply the debounced re-renders for no benefit. This
 *  hook is the read-only mirror of `useProfileSnippet` in
 *  [UserMenu.tsx](../components/shell/UserMenu.tsx), narrowed to
 *  just the displayName.
 *
 *  Returns `null` while the IDB row is loading or when no row
 *  exists yet. Callers should treat the null case as "no
 *  personalization" and render the neutral copy. */
export function useDisplayName(): string | null {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getProfile()
        .then((p: PersonalInfo | null) => {
          if (cancelled) return;
          const raw = p?.displayName?.trim();
          setDisplayName(raw && raw.length > 0 ? raw : null);
        })
        .catch(() => {
          // IDB unavailable (private-mode + quota) — leave null;
          // sections fall through to the un-personalized copy.
        });
    }
    load();
    const unsubscribe = subscribeProfileChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return displayName;
}
