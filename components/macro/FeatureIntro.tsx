"use client";

import { cn } from "@/lib/utils";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { X, type LucideIcon } from "lucide-react";

/** A short, personalized explainer that sits above a feature
 *  section to tell the user what the feature does — in plain
 *  language, before the controls.
 *
 *  Used by `SecurityIntro` (one consolidated intro at the top of the
 *  Settings Security group, covering two-step verification, passkeys,
 *  and backup email). Each instance is dismissible and the dismissal
 *  is sticky per-device via localStorage — once a user has read it on
 *  their primary device, it stops re-appearing.
 *
 *  Visual style: a faint tint over the card background, a circled
 *  icon on the left, an X-to-dismiss on the right. Deliberately
 *  lighter-weight than the section cards below so it reads as
 *  "context, not control" — eyes flow past it once read.
 *
 *  Personalization rule: if a `displayName` is supplied AND is
 *  non-empty, we open with "Hi {name} —". Otherwise the intro
 *  starts with the blurb directly. Greeting an empty name as
 *  "Hi —" reads broken; the name-less variant just gets straight
 *  to the point. */
type Tint = "sky" | "amber" | "emerald";

const TINT_CLASS: Record<Tint, { bg: string; ring: string; iconBg: string }> = {
  sky: {
    bg: "bg-sky-500/[0.06] dark:bg-sky-400/[0.06]",
    ring: "ring-sky-500/20 dark:ring-sky-400/15",
    iconBg: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  },
  amber: {
    bg: "bg-amber-500/[0.06] dark:bg-amber-400/[0.06]",
    ring: "ring-amber-500/20 dark:ring-amber-400/15",
    iconBg:
      "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  },
  emerald: {
    bg: "bg-emerald-500/[0.06] dark:bg-emerald-400/[0.06]",
    ring: "ring-emerald-500/20 dark:ring-emerald-400/15",
    iconBg:
      "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  },
};

export type FeatureIntroProps = {
  /** Stable localStorage key — once dismissed, the intro stays
   *  hidden on this device. Use `feature-intro:<feature>` to keep
   *  keys discoverable in DevTools. */
  storageKey: string;
  /** Lucide icon for the left badge. Pass the *component*, not an
   *  instance — we render it with our own sizing. */
  icon: LucideIcon;
  /** Background tint. Pick one that fits the intent — sky (informational),
   *  amber (security/attention), or emerald (recovery, calm). */
  tint?: Tint;
  /** Optional user display name. When provided + non-empty, the
   *  intro opens with a personal greeting. */
  displayName?: string | null;
  /** Main explainer text. One or two short sentences. Plain
   *  strings render cleanly; pass nodes only when you need
   *  emphasis. */
  blurb: string;
};

/** localStorage key prefix gives all intros a discoverable namespace
 *  ("feature-intro:..."). Listing them in DevTools makes it obvious
 *  to a maintainer what these keys are for. */
const STORAGE_PREFIX = "maqro:feature-intro:";

function getStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

/** Subscribe to a single localStorage key. Uses the `storage` event
 *  so a dismiss in another tab hides this intro in the current tab
 *  too — without it, the user would have to refresh to see their
 *  dismissal mirror across tabs. */
function subscribeDismissed(key: string) {
  return (notify: () => void) => {
    function onStorage(e: StorageEvent) {
      if (e.key === getStorageKey(key)) notify();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  };
}

function getDismissedSnapshot(key: string): boolean {
  try {
    return window.localStorage.getItem(getStorageKey(key)) === "1";
  } catch {
    // Private mode / quota — treat as "not dismissed". The user
    // sees the intro every visit; harmless degradation.
    return false;
  }
}

function getServerDismissedSnapshot(): boolean {
  // Server has no localStorage. Render the intro by default; the
  // client snapshot resolves on hydration and may hide it. The
  // server-default-visible posture matches the "first-visit
  // explainer" intent — a fresh user with no localStorage state
  // sees it.
  return false;
}

export function FeatureIntro({
  storageKey,
  icon: Icon,
  tint = "sky",
  displayName,
  blurb,
}: FeatureIntroProps) {
  // Memoize the subscribe + getSnapshot closures by key so
  // useSyncExternalStore sees stable references across renders.
  // An unstable subscribe forces React to tear down and re-establish
  // the storage-event listener on every paint, which produces
  // flaky behavior under tests and a measurable cost in prod.
  const subscribe = useMemo(() => subscribeDismissed(storageKey), [storageKey]);
  const getSnapshot = useCallback(
    () => getDismissedSnapshot(storageKey),
    [storageKey],
  );
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerDismissedSnapshot,
  );

  const onDismiss = useCallback(() => {
    try {
      window.localStorage.setItem(getStorageKey(storageKey), "1");
      // Fire a synthetic storage event so the snapshot subscriber
      // in *this* tab notices. The native `storage` event only
      // fires in *other* tabs.
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: getStorageKey(storageKey),
          newValue: "1",
        }),
      );
    } catch {
      // Quota / private mode — there's no persistent dismissal we
      // can offer. Leaving the intro in place is the least
      // surprising outcome.
    }
  }, [storageKey]);

  if (dismissed) return null;

  const t = TINT_CLASS[tint];
  const trimmedName = typeof displayName === "string" ? displayName.trim() : "";
  const greeting = trimmedName ? `Hi ${trimmedName} — ` : "";

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-lg px-4 py-3 ring-1 ring-inset",
        t.bg,
        t.ring,
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          t.iconBg,
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="min-w-0 flex-1 pt-1 text-xs leading-relaxed text-foreground/90">
        {greeting && (
          <span className="font-medium text-foreground">{greeting}</span>
        )}
        {blurb}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
