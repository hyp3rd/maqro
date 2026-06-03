"use client";

import Link from "next/link";
import { FastingChip } from "./FastingChip";
import { LogoMark } from "./LogoMark";
import { NotificationBell } from "./NotificationBell";
import type { ViewKey } from "./Sidebar";
import { SyncModeIndicator } from "./SyncModeIndicator";
import { SyncStatusPill } from "./SyncStatusPill";
import { ThemeToggle } from "./ThemeToggle";
import { TopbarSearchButton } from "./TopbarSearchButton";
import { UserMenu } from "./UserMenu";

const LABELS: Record<ViewKey, string> = {
  calculator: "Calculator",
  plan: "Meal Plan",
  progress: "Progress",
  fasting: "Fasting",
  foods: "My Foods",
  recipes: "Recipes",
  templates: "Meal Templates",
  shopping: "Shopping List",
  pantry: "Pantry",
  settings: "Settings",
};

type Props = {
  current: ViewKey;
  /** Forwarded to the mobile `UserMenu` so it can surface the
   *  Settings + Templates entries that we removed from the bottom
   *  tab bar to declutter it. Desktop ignores it (the sidebar
   *  already exposes those views directly). */
  onSelectView?: (key: ViewKey) => void;
};

export function Topbar({ current, onSelectView }: Props) {
  return (
    // `min-h-14`, not `h-14`. Same reason the bottom nav uses
    // `min-h`: `pt-safe` adds `env(safe-area-inset-top)` as
    // padding INSIDE the box, and on iPhone with Dynamic Island
    // that inset is ~59 px - larger than the 56 px `h-14` would
    // allow. Fixed-height forced the title to render under the
    // Dynamic Island. `min-h-14` lets the bar grow to
    // `56 + safe-area`, so the title sits cleanly below the notch.
    // Non-PWA browsers (where safe-area-inset-top is 0) still
    // render the bar at exactly 56 px - no visible change there.
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/80 px-4 pt-safe backdrop-blur-sm sm:px-6">
      {/* Brand mark - visible on mobile only, since the sidebar
       *  (which carries the wordmark on desktop) collapses out of
       *  view at md− widths. Acts as a "home" affordance too: tapping
       *  it goes back to the landing, mirroring the sidebar's brand
       *  link on desktop. Hidden at md+ to avoid duplicate branding
       *  alongside the sidebar wordmark. */}
      <Link
        href="/"
        aria-label="Maqro - visit homepage"
        className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-foreground transition-colors hover:bg-accent/40 md:hidden"
      >
        <LogoMark
          size={18}
          title=""
        />
      </Link>
      <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
        {LABELS[current]}
      </h1>
      {/* Spacer + search button take the middle column; on mobile
          the search button collapses to an icon-only affordance and
          the rest of the toolbar gets the remaining width. */}
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <TopbarSearchButton />
        <FastingChip onSelectView={onSelectView} />
        <SyncModeIndicator onSelectView={onSelectView} />
        <SyncStatusPill />
        {/* Notifications + theme are dedicated controls on desktop. On
            mobile the bar gets crowded next to the sync chips, so both
            move into the avatar menu below (and the unread count moves
            onto the avatar as a red badge). */}
        <div className="hidden items-center gap-2 md:flex sm:gap-3">
          <NotificationBell onSelectView={onSelectView} />
          <ThemeToggle />
        </div>
        {/* The UserMenu lives in the desktop sidebar footer; mirror it in
            the topbar on mobile so sign-out / display-name stay reachable
            without scrolling around for them. On mobile it also hosts the
            theme + notifications controls moved out of the bar above. */}
        <div className="md:hidden">
          <UserMenu
            compact
            onSelectView={onSelectView}
          />
        </div>
      </div>
    </header>
  );
}
