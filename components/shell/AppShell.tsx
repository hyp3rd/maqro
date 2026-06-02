"use client";

import { MfaChallengeDialog } from "@/components/auth/MfaChallengeDialog";
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CommandPalette } from "./CommandPalette";
import { DemoSeed } from "./DemoSeed";
import { Footer } from "./Footer";
import { InstallPrompt } from "./InstallPrompt";
import { MobileBottomNav } from "./MobileBottomNav";
import { PastDueBanner } from "./PastDueBanner";
import { PullToSync } from "./PullToSync";
import { ServiceWorkerProvider } from "./ServiceWorkerProvider";
import { Sidebar, type ViewKey } from "./Sidebar";
import { StorageBanner } from "./StorageBanner";
import { SyncManager } from "./SyncManager";
import { SyncModeController } from "./SyncModeController";
import { Topbar } from "./Topbar";
import { UpdateBanner } from "./UpdateBanner";

type Props = {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  children: React.ReactNode;
};

/** Top-level app chrome: sidebar nav on the left (desktop) or bottom tab
 * bar (mobile), topbar on top, animated content area filling the rest.
 *
 * Layout invariant: the outer container is exactly viewport height
 * (`h-screen`), the main column is the only thing that scrolls. This keeps
 * the sidebar footer (UserMenu) pinned to the bottom and the mobile bottom
 * nav above the keyboard. The animated wrapper keys off `current` so
 * switching nav items produces a soft fade/translate transition. */
export function AppShell({ current, onSelect, children }: Props) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <DemoSeed />
      <ServiceWorkerProvider />
      <SyncManager />
      <SyncModeController />
      <Sidebar
        current={current}
        onSelect={onSelect}
      />
      {/* `suppressHydrationWarning` here is for browser extensions
          (notably ProtonPass, Bitwarden) that inject form-detection
          attributes on `<main>` after SSR but before React hydrates,
          producing a hydration mismatch we can't otherwise fix. The
          suppression only affects attribute matching on this exact
          element - descendant hydration is still strictly checked. */}
      <main
        className="flex min-w-0 flex-1 flex-col"
        suppressHydrationWarning
      >
        <Topbar
          current={current}
          onSelectView={onSelect}
        />
        {/* Billing dunning sits above the storage banner because a
         *  failed payment is louder than a storage warning: it
         *  threatens loss of premium access on a clock (Stripe's
         *  retry window) while storage is a session-level
         *  inconvenience. Banner is dismissible per-session; the
         *  authoritative non-dismissible alert lives in Settings →
         *  Billing for users who choose to ignore the banner. */}
        <PastDueBanner />
        <StorageBanner />
        <PullToSync className="relative flex flex-1 flex-col">
          <AnimatePresence
            mode="wait"
            initial={false}
          >
            <motion.div
              key={current}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              // Tighter horizontal + vertical padding on mobile so
              // content gets every spare pixel of the 375 px viewport.
              // sm+ goes back to the original generous padding. Bottom
              // padding on mobile is added below the AnimatePresence
              // on the footer wrapper to clear the fixed bottom tab
              // bar (min-h-14 content + env(safe-area-inset-bottom)).
              className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-8 lg:py-10"
            >
              {children}
            </motion.div>
          </AnimatePresence>
          {/* Footer sits at the bottom of the scrollable area - scrolls
              with content rather than pinning to the viewport. The
              mobile bottom nav still floats over it via fixed
              positioning. Mobile padding here clears the bottom nav. */}
          <div className="pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-0">
            <Footer />
          </div>
        </PullToSync>
      </main>
      <MobileBottomNav
        current={current}
        onSelect={onSelect}
      />
      <InstallPrompt />
      <UpdateBanner />
      <CommandPalette onSelectView={onSelect} />
      {/* Global MFA prompt — any in-app fetch that hits the AAL2
          gate routes through `clientFetch`, which surfaces this
          dialog instead of bouncing the user to /login. One
          mount per app session; the bus coalesces concurrent
          requests so we never stack dialogs. */}
      <MfaChallengeDialog />
    </div>
  );
}
