"use client";

import {
  CHANGELOG_SEEN_STORAGE_KEY,
  LATEST_CHANGELOG_ID,
} from "@/lib/changelog";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** "What's new" indicator. Renders a `/changelog` link with a small
 *  dot when the latest entry id differs from the user's
 *  localStorage "seen" value.
 *
 *  Implementation: `useSyncExternalStore` for SSR-safe reads.
 *  The server gets `null` from the snapshot, which renders as "no
 *  dot" - same visual state as a user who's already seen
 *  everything. The client hydrates and either keeps that state or
 *  flips the dot on. No hydration mismatch either way.
 *
 *  Subscriber listens to `storage` events so a sibling tab that
 *  opens `/changelog` (and writes the seen key) updates this tab's
 *  indicator immediately. */

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): string | null {
  try {
    return window.localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export function ChangelogIndicator() {
  const t = useTranslations("changelogIndicator");
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hasNew = seen !== null && seen !== LATEST_CHANGELOG_ID;
  const showDot = seen === null || hasNew;

  return (
    <Link
      href="/changelog"
      className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-foreground"
      // We intentionally don't try to count the gap between `seen`
      // and `LATEST_CHANGELOG_ID` here — that would require a
      // structural diff of the changelog source and gives little
      // ARIA value beyond "there are new entries". The terse label
      // is what screen-reader users actually want.
      aria-label={
        showDot ? t("ariaWithEntries", { count: 1 }) : t("ariaNoEntries")
      }
    >
      <span>{t("whatsNew")}</span>
      {showDot && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
