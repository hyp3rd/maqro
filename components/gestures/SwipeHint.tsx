"use client";

import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import { ArrowLeftRight, X } from "lucide-react";

/** A one-time, dismissible coach-mark for swipeable lists.
 *
 *  [SwipeRow](./SwipeRow.tsx) adds swipe-to-act gestures that are
 *  otherwise invisible — there's no chrome telling a first-time user a
 *  row can be swiped. This renders a small banner above the list the
 *  first time they see it, then remembers the dismissal in localStorage
 *  (keyed per surface, since pantry and shopping list teach different
 *  swipes). It only renders on coarse pointers — the swipe gestures
 *  themselves are touch-only, so showing the hint to mouse users (who
 *  keep the explicit buttons) would be noise.
 *
 *  The localStorage read happens in the lazy initializer (not an effect);
 *  paired with the `isTouch` gate — which returns false on the first
 *  render to match SSR, then resolves post-hydration — the hint never
 *  paints before hydration, so there's no flash and no mismatch. */
export function SwipeHint({
  storageKey,
  className,
  children,
}: {
  /** Stable per-surface key, e.g. `maqro:hint:pantry-swipe`. */
  storageKey: string;
  className?: string;
  children: ReactNode;
}) {
  const isTouch = useCoarsePointer();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      // Private mode / blocked storage — treat as dismissed so we don't
      // nag on every mount with no way to remember the dismissal.
      return true;
    }
  });

  if (!isTouch || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Best-effort; the in-memory flag below still hides it this session.
    }
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{children}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss hint"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
