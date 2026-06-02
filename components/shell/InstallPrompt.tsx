"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useState, useSyncExternalStore } from "react";
import { Download, Share, X } from "lucide-react";

/** `false` during SSR + the first client render, `true` after hydration —
 *  via `useSyncExternalStore` so there's no `setState`-in-effect (which
 *  the repo's lint forbids). Mirrors the same helper in ThemeToggle. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** localStorage key recording the user's "not now" dismissal. We
 *  back off for 30 days before re-prompting — long enough that the
 *  prompt doesn't feel pushy, short enough that someone who said
 *  "not now" mid-task gets a second chance next month. Two keys
 *  because iOS and the native-prompt flow are distinct user
 *  decisions: dismissing iOS instructions shouldn't mute a future
 *  Chrome `beforeinstallprompt` (or vice versa). */
const DISMISSED_KEY_NATIVE = "maqro:install-prompt-dismissed-native";
const DISMISSED_KEY_IOS = "maqro:install-prompt-dismissed-ios";
const DISMISSAL_MS = 30 * 24 * 60 * 60 * 1000;

function isRecentlyDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const at = window.localStorage.getItem(key);
    if (!at) return false;
    const ts = Number.parseInt(at, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISSAL_MS;
  } catch {
    return false;
  }
}

function recordDismissal(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, Date.now().toString());
  } catch {
    // Storage disabled — the prompt will re-appear on next load,
    // which is the less-bad failure mode.
  }
}

function computeHidden(args: {
  canInstall: boolean;
  isIOS: boolean;
  isInstalled: boolean;
  _: number;
}): boolean {
  if (args.isInstalled) return true;
  if (args.canInstall) return isRecentlyDismissed(DISMISSED_KEY_NATIVE);
  if (args.isIOS) return isRecentlyDismissed(DISMISSED_KEY_IOS);
  return true;
}

/** PWA install affordance with two surfaces:
 *
 *    1. A small bottom-anchored banner that appears once Chrome /
 *       Edge / Android have fired `beforeinstallprompt` (and the
 *       user hasn't dismissed in the last 30 days). Clicking
 *       Install triggers the native prompt; dismissing records
 *       the back-off.
 *    2. An "Install on iOS" dialog reachable from the same banner
 *       (visible only on iOS) — shows the Share → Add to Home
 *       Screen instructions since iOS Safari has no programmatic
 *       install API.
 *
 *  Hidden entirely when:
 *    - App is already running in standalone mode
 *    - Neither path is available (Firefox desktop, etc.)
 *    - User has dismissed within the back-off window */
export function InstallPrompt() {
  const { canInstall, isIOS, isInstalled, install } = usePwaInstall();
  // Visibility is derived: it's a function of the hook's reactive
  // values plus a manual dismissal flag. The lint rule forbids
  // setState-in-effect, so we keep `dismissed` as the only piece
  // of local state and compute `hidden` synchronously during
  // render. `dismissedSession` bumps after the user dismisses
  // (or successfully installs) so we re-read the localStorage
  // timestamp without round-tripping through an effect.
  const [dismissedSession, setDismissedSession] = useState(0);
  const [iosOpen, setIosOpen] = useState(false);

  // The banner's visibility depends on client-only signals — PWA
  // installability (`navigator`-derived), standalone mode, and the
  // localStorage dismissal timestamp. On the server they're all absent,
  // so the server renders `null`; on the first client render they resolve
  // and the banner would appear, which is a hydration mismatch (#418, and
  // it regenerates the whole tree). Gate on `mounted` so the first client
  // render also yields `null` — matching the server — and the banner then
  // appears on the post-hydration re-render.
  const mounted = useMounted();

  const hidden = computeHidden({
    canInstall,
    isIOS,
    isInstalled,
    // `dismissedSession` is read here so React schedules a
    // re-render when it changes. Its value is otherwise unused —
    // it exists only as a re-render trigger.
    _: dismissedSession,
  });

  async function handleInstall() {
    const accepted = await install();
    if (!accepted) {
      // User dismissed via the native prompt — treat it as a
      // 30-day "not now" so we don't immediately re-offer.
      recordDismissal(DISMISSED_KEY_NATIVE);
    }
    setDismissedSession((n) => n + 1);
  }

  function handleDismissNative() {
    recordDismissal(DISMISSED_KEY_NATIVE);
    setDismissedSession((n) => n + 1);
  }

  function handleDismissIos() {
    recordDismissal(DISMISSED_KEY_IOS);
    setDismissedSession((n) => n + 1);
  }

  if (!mounted || hidden) return null;

  return (
    <>
      {/* Bottom-floating banner. Pinned via `fixed bottom-0` with
          a safe-area-aware padding so it stays clear of the iOS
          home indicator and clears the mobile bottom-nav (h-14 + safe).
          z-50 sits above the bottom-nav but below open dialogs. */}
      <div
        role="dialog"
        aria-label="Install Maqro"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] sm:pb-4"
      >
        <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-lg">
          <Download className="h-5 w-5 shrink-0 text-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              Install Maqro
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {canInstall
                ? "One-tap install — runs offline, no app store."
                : "Add to your home screen for a full-screen app feel."}
            </p>
          </div>
          {canInstall ? (
            <Button
              type="button"
              size="sm"
              onClick={handleInstall}
              className="h-8 shrink-0"
            >
              Install
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setIosOpen(true)}
              className="h-8 shrink-0"
            >
              How
            </Button>
          )}
          <button
            type="button"
            onClick={canInstall ? handleDismissNative : handleDismissIos}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog
        open={iosOpen}
        onOpenChange={setIosOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Maqro to your home screen</DialogTitle>
            <DialogDescription>
              iOS Safari handles installs through the Share menu. Three taps and
              Maqro launches like a native app — full-screen, no browser chrome,
              works offline.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 py-2 text-sm leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
                1
              </span>
              <span>
                Tap the <Share className="inline h-3.5 w-3.5" /> Share button in
                Safari&apos;s toolbar (bottom of the screen on iPhone, top-right
                on iPad).
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
                2
              </span>
              <span>
                Scroll down and tap{" "}
                <strong className="font-medium">Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
                3
              </span>
              <span>
                Confirm <strong className="font-medium">Add</strong> in the
                top-right. The Maqro icon appears on your home screen — tap it
                to launch.
              </span>
            </li>
          </ol>
          <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Note: this only works in <strong>Safari</strong>, not Chrome on iOS
            (Apple restricts the install API to their own browser). If
            you&apos;re in Chrome, tap the address bar → Open in Safari first.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
