"use client";

import { UnsyncedChangesDialog } from "@/components/auth/UnsyncedChangesDialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotificationDrawer } from "@/hooks/use-notification-drawer";
import { useSafeSignOut } from "@/hooks/use-safe-sign-out";
import { useUser } from "@/hooks/use-user";
import {
  OFFLINE_UNVERIFIED_HINT,
  OFFLINE_UNVERIFIED_LABEL,
} from "@/lib/auth/offline-unverified-copy";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import { getProfile } from "@/lib/db";
import { subscribeProfileChanged } from "@/lib/profile-bus";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Bell, CloudOff, Home, LogIn, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { NotificationsSheet } from "./NotificationsSheet";
import { ThemeMenuItem } from "./ThemeMenuItem";
import { NAV, type ViewKey } from "./nav";

type UserMenuProps = {
  /** Compact mode: render just the avatar (no name text), suitable for
   * the mobile topbar where horizontal space is tight. The full name +
   * email still appear inside the dropdown content. */
  compact?: boolean;
  /** Switches the app view. With it the menu offers Settings (its one
   *  navigation entry, so Settings is two taps from anywhere; the rest of
   *  the navigation lives in the tab bar, the More sheet and the sidebar).
   *  In the mobile topbar (`compact`) the menu then also hosts the
   *  notifications (whose entries open the view they point at) and the
   *  theme, moved out of the cramped topbar. */
  onSelectView?: (key: ViewKey) => void;
};

/** Sidebar footer chip (or topbar avatar in compact mode). Four states:
 *   - Loading: muted "…" placeholder while the auth client resolves.
 *   - Offline-unverified: a non-interactive "Server unreachable" chip — not
 *     "Sign in", since the account's data is still shown, and no Sign out,
 *     which needs the session (it is re-checked as soon as the network
 *     returns). Its explanation is in the title and, for screen readers, in
 *     visually hidden text.
 *   - Signed out (or unconfigured): "Sign in" link to /login.
 *   - Signed in: avatar + email + dropdown with Sign out. */
export function UserMenu({
  compact = false,
  onSelectView,
}: UserMenuProps = {}) {
  const { user, isLoaded, isUnconfigured, isOfflineUnverified } = useUser();
  const { displayName, isAdmin } = useProfileSnippet();
  // Mobile-only: the avatar menu also hosts notifications + theme, moved
  // out of the cramped topbar. `mobileExtras` gates them so the desktop
  // sidebar instance (no `onSelectView`) keeps its lean menu. The hook is
  // always called to keep hook order stable across renders.
  const drawer = useNotificationDrawer(onSelectView);
  const mobileExtras = compact && Boolean(onSelectView);
  // Sync first, confirm before discarding anything unsynced, then wipe + sign
  // out and hard-navigate so no in-memory copy of this account's data (the
  // displayed day, the profile form) survives into the signed-out session.
  const safeSignOut = useSafeSignOut(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await signOutAndClearLocal(supabase, user?.id);
    window.location.assign("/login");
  });

  if (!isLoaded) {
    return (
      <div
        className={
          compact
            ? "flex h-8 items-center"
            : "flex h-9 items-center gap-2.5 rounded-md px-2.5"
        }
      >
        <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
        {!compact && (
          <div className="h-2 w-16 animate-pulse rounded bg-muted" />
        )}
      </div>
    );
  }

  // Signed-out branch. When the menu is in `compact` mode AND the
  // caller wires `onSelectView` (i.e. the mobile top bar) we still
  // render a dropdown: it hosts the guest's notifications and theme,
  // which have no other home on a phone. The signed-in path below
  // builds the same shape.
  if (!user && compact && onSelectView) {
    return (
      <SignedOutMenu
        isUnconfigured={isUnconfigured}
        isOfflineUnverified={isOfflineUnverified}
        onSelectView={onSelectView}
      />
    );
  }

  if (!user && isOfflineUnverified) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2.5 rounded-md text-sm text-muted-foreground",
          compact ? "h-8 w-8 justify-center" : "w-full px-2.5 py-1.5",
        )}
        title={OFFLINE_UNVERIFIED_HINT}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
          <CloudOff
            className="h-3 w-3"
            aria-hidden
          />
        </div>
        {!compact && (
          <span className="flex-1 text-left">{OFFLINE_UNVERIFIED_LABEL}</span>
        )}
        {/* `title` alone is not reliably announced, so the explanation is
            in the accessible text too, compact or not. */}
        <span className="sr-only">{OFFLINE_UNVERIFIED_HINT}</span>
      </div>
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={cn(
          "flex items-center gap-2.5 rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          compact ? "h-8 w-8 justify-center" : "w-full px-2.5 py-1.5",
        )}
        title={
          isUnconfigured
            ? "Supabase not configured - see README"
            : "Sign in for multi-device sync"
        }
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
          <LogIn className="h-3 w-3" />
        </div>
        {!compact && (
          <span className="flex-1 text-left">
            {isUnconfigured ? "Guest" : "Sign in"}
          </span>
        )}
      </Link>
    );
  }

  const email = user.email ?? "Signed in";
  const primary = displayName ?? email;
  const initial = (displayName?.[0] ?? user.email?.[0] ?? "?").toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "relative flex items-center gap-2.5 rounded-md text-sm text-foreground transition-colors hover:bg-accent",
              compact ? "h-8 w-8 justify-center" : "w-full px-2.5 py-1.5",
            )}
            aria-label={
              compact
                ? mobileExtras && drawer.unreadCount > 0
                  ? `${primary} — ${drawer.unreadCount} unread notifications`
                  : primary
                : undefined
            }
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">
              {initial}
            </div>
            {/* Mobile: the notification count rides on the avatar so the
              user spots unread pantry alerts without a separate bell. */}
            {mobileExtras && drawer.unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 py-0 text-[10px] leading-none"
              >
                {drawer.unreadCount > 9 ? "9+" : drawer.unreadCount}
              </Badge>
            )}
            {!compact && (
              <span className="flex-1 truncate text-left">{primary}</span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-56"
        >
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {displayName ? (
              <>
                <span className="block text-foreground">{displayName}</span>
                <span className="block text-[10px]">{email}</span>
              </>
            ) : (
              email
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onSelectView && <SettingsMenuItem onSelectView={onSelectView} />}
          {/* Mobile-only: notifications + theme, relocated from the topbar.
            The bell's unread count also surfaces on the avatar badge
            above; opening the drawer (openDrawer) clears it. */}
          {mobileExtras && (
            <>
              <DropdownMenuItem
                onSelect={drawer.openDrawer}
                className="gap-2"
              >
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1">Notifications</span>
                {drawer.unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="h-4 min-w-4 justify-center px-1 py-0 text-[10px] leading-none"
                  >
                    {drawer.unreadCount > 9 ? "9+" : drawer.unreadCount}
                  </Badge>
                )}
              </DropdownMenuItem>
              <ThemeMenuItem />
              <DropdownMenuSeparator />
            </>
          )}
          {/* Landing page is the only route outside /app the user might
            want to revisit while signed in (pricing, FAQ, marketing
            content). Surfaced here rather than in the sidebar nav
            because it's a one-off destination, not a workspace tab. */}
          <DropdownMenuItem asChild>
            <Link
              href="/"
              className="gap-2"
            >
              <Home className="h-3.5 w-3.5 text-muted-foreground" />
              Visit homepage
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            // Admin nav lives at /admin and has its own top-bar with
            // session indicator. Surfacing the entry here is the only
            // way for an admin to reach it from a mobile viewport,
            // where the desktop sidebar nav isn't visible.
            <DropdownMenuItem asChild>
              <Link
                href="/admin"
                className="gap-2"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                Admin panel
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void safeSignOut.requestSignOut()}
            disabled={safeSignOut.busy}
            className="gap-2"
          >
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Siblings of the menu (not nested in its content) so they survive
          the dropdown closing when their item is selected. */}
      <UnsyncedChangesDialog {...safeSignOut.dialog} />
      {mobileExtras && (
        <NotificationsSheet
          open={drawer.open}
          onOpenChange={drawer.setOpen}
          notifications={drawer.notifications}
          onView={drawer.onView}
          onDismiss={drawer.onDismiss}
        />
      )}
    </>
  );
}

/** Guest-mode equivalent of the signed-in dropdown. Mirrors the same
 *  affordances minus account-only items (no Sign-out, no Admin) and
 *  swaps in a "Sign in" call to action. We render this exclusively
 *  in the mobile top-bar context — desktop guests have the bell and
 *  theme toggle in the topbar, so the sidebar's `<UserMenu />` still
 *  resolves to the plain "Sign in" Link via the branch above.
 *
 *  Why a dropdown for a guest at all: on a phone the notifications
 *  and the theme live only here.
 *
 *  Offline-unverified uses the same menu, labelled with the offline-
 *  unverified explanation and without "Sign in": the account is still on
 *  this device and is verified again when the network returns. */
function SignedOutMenu({
  isUnconfigured,
  isOfflineUnverified,
  onSelectView,
}: {
  isUnconfigured: boolean;
  isOfflineUnverified: boolean;
  onSelectView: (key: ViewKey) => void;
}) {
  // Guests still have a local pantry (and so local low-stock alerts) and
  // a theme preference — both were reachable from the topbar before they
  // moved into this menu, so keep them here too.
  const drawer = useNotificationDrawer(onSelectView);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative flex h-8 w-8 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={
              drawer.unreadCount > 0
                ? `Account menu — ${drawer.unreadCount} unread notifications`
                : "Account menu"
            }
            title={
              isUnconfigured
                ? "Supabase not configured — see README"
                : "Account menu"
            }
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {isOfflineUnverified ? (
                <CloudOff className="h-3 w-3" />
              ) : (
                <LogIn className="h-3 w-3" />
              )}
            </div>
            {drawer.unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 py-0 text-[10px] leading-none"
              >
                {drawer.unreadCount > 9 ? "9+" : drawer.unreadCount}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-56"
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {isOfflineUnverified ? OFFLINE_UNVERIFIED_HINT : "Guest mode"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <SettingsMenuItem onSelectView={onSelectView} />
          <DropdownMenuItem
            onSelect={drawer.openDrawer}
            className="gap-2"
          >
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">Notifications</span>
            {drawer.unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="h-4 min-w-4 justify-center px-1 py-0 text-[10px] leading-none"
              >
                {drawer.unreadCount > 9 ? "9+" : drawer.unreadCount}
              </Badge>
            )}
          </DropdownMenuItem>
          <ThemeMenuItem />
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href="/"
              className="gap-2"
            >
              <Home className="h-3.5 w-3.5 text-muted-foreground" />
              Visit homepage
            </Link>
          </DropdownMenuItem>
          {!isUnconfigured && !isOfflineUnverified && (
            <DropdownMenuItem asChild>
              <Link
                href="/login"
                className="gap-2"
              >
                <LogIn className="h-3.5 w-3.5 text-muted-foreground" />
                Sign in
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationsSheet
        open={drawer.open}
        onOpenChange={drawer.setOpen}
        notifications={drawer.notifications}
        onView={drawer.onView}
        onDismiss={drawer.onDismiss}
      />
    </>
  );
}

/** The account menu's Settings entry, named and drawn from the nav registry
 *  so it can't drift from the sidebar and the More sheet. */
function SettingsMenuItem({
  onSelectView,
}: {
  onSelectView: (key: ViewKey) => void;
}) {
  const { label, icon: Icon } = NAV.settings;
  return (
    <DropdownMenuItem
      onSelect={() => onSelectView("settings")}
      className="gap-2"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {label}
    </DropdownMenuItem>
  );
}

/** Reads `displayName` from the local IDB profile (subscribed to
 *  `profile-bus` for cross-component freshness) AND the `role`
 *  field straight from the Supabase `profiles` row - the local
 *  PersonalInfo doesn't carry `role` because it's a server-managed
 *  field and we don't want users to write it.
 *
 *  Admin status drives the "Admin panel" dropdown entry, which is
 *  the only way to reach /admin from a mobile viewport (the
 *  desktop sidebar nav is hidden there). The /admin route enforces
 *  the gate regardless, so a stale local "isAdmin=false" just
 *  hides an entry that the user could still type the URL for -
 *  no security concern.
 *
 *  We don't use `useProfile` for the displayName piece because it
 *  owns a debounced WRITE loop and the menu should be read-only. */
function useProfileSnippet(): { displayName: string | null; isAdmin: boolean } {
  const [snippet, setSnippet] = useState<{
    displayName: string | null;
    isAdmin: boolean;
  }>({ displayName: null, isAdmin: false });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // displayName lives in the local IDB profile; role is server-
      // only. Fire both in parallel and merge.
      const supabase = getSupabaseBrowser();
      const [localProfile, roleRow] = await Promise.all([
        getProfile().catch(() => null),
        supabase
          ? supabase.auth.getUser().then(({ data }) => {
              if (!data.user) return null;
              return supabase
                .from("profiles")
                .select("role")
                .eq("user_id", data.user.id)
                .maybeSingle();
            })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const v = (localProfile?.displayName ?? "").trim();
      const role =
        (roleRow as { data?: { role?: string | null } } | null)?.data?.role ??
        null;
      setSnippet({
        displayName: v.length > 0 ? v : null,
        isAdmin: role === "admin",
      });
    };
    void load();
    const off = subscribeProfileChanged(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return snippet;
}
