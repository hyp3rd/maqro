"use client";

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
import { useUser } from "@/hooks/use-user";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import { getProfile } from "@/lib/db";
import { subscribeProfileChanged } from "@/lib/profile-bus";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import {
  Bell,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  Package,
  Settings as SettingsIcon,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import Link from "next/link";
import { NotificationsSheet } from "./NotificationsSheet";
import type { ViewKey } from "./Sidebar";
import { ThemeMenuItem } from "./ThemeMenuItem";

type UserMenuProps = {
  /** Compact mode: render just the avatar (no name text), suitable for
   * the mobile topbar where horizontal space is tight. The full name +
   * email still appear inside the dropdown content. */
  compact?: boolean;
  /** When provided (mobile topbar only), the dropdown surfaces
   *  Settings + Templates entries that were removed from the bottom
   *  tab bar to declutter it. Desktop sidebar already has those
   *  views directly, so the desktop instance passes nothing here
   *  and the items don't render. */
  onSelectView?: (key: ViewKey) => void;
};

/** Sidebar footer chip (or topbar avatar in compact mode). Three states:
 *   - Loading: muted "…" placeholder while the auth client resolves.
 *   - Signed out (or unconfigured): "Sign in" link to /login.
 *   - Signed in: avatar + email + dropdown with Sign out. */
export function UserMenu({
  compact = false,
  onSelectView,
}: UserMenuProps = {}) {
  const { user, isLoaded, isUnconfigured } = useUser();
  const { displayName, isAdmin } = useProfileSnippet();
  // Mobile-only: the avatar menu also hosts notifications + theme, moved
  // out of the cramped topbar. `mobileExtras` gates them so the desktop
  // sidebar instance (no `onSelectView`) keeps its lean menu. The hook is
  // always called to keep hook order stable across renders.
  const drawer = useNotificationDrawer(onSelectView);
  const mobileExtras = compact && Boolean(onSelectView);

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
  // need to render a dropdown — otherwise the guest user can't
  // reach Settings or Templates at all, because those were moved
  // out of the bottom tab bar to declutter it and currently live
  // only behind this menu. Skip to the signed-out dropdown
  // immediately; the signed-in path below builds the same shape.
  if (!user && compact && onSelectView) {
    return (
      <SignedOutMenu
        isUnconfigured={isUnconfigured}
        onSelectView={onSelectView}
      />
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

  async function signOut() {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await signOutAndClearLocal(supabase);
  }

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
          {/* Mobile-only: Settings + Templates moved out of the bottom
            tab bar (8 → 6 items) so the primary nav reads cleaner.
            Both are still one tap away from anywhere via the avatar
            chip. Skipped when `onSelectView` isn't passed (desktop
            sidebar surfaces both views directly). */}
          {onSelectView && (
            <>
              <DropdownMenuItem
                onSelect={() => onSelectView("profile")}
                className="gap-2"
              >
                <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onSelectView("settings")}
                className="gap-2"
              >
                <SettingsIcon className="h-3.5 w-3.5 text-muted-foreground" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onSelectView("templates")}
                className="gap-2"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                Templates
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onSelectView("pantry")}
                className="gap-2"
              >
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                Pantry
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
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
            onClick={signOut}
            className="gap-2"
          >
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Sibling of the menu (not nested in its content) so it survives
          the dropdown closing when the Notifications item is selected. */}
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
 *  in the mobile top-bar context — desktop guests have the sidebar
 *  nav for Settings / Templates, so the sidebar's `<UserMenu />`
 *  still resolves to the plain "Sign in" Link via the branch above.
 *
 *  Why a dropdown for a guest at all: the previous version
 *  collapsed straight to a "Sign in" link. After Settings + Templates
 *  moved out of the bottom tab bar, that left a signed-out mobile
 *  user with no path to either view — they could see the app's
 *  data but not change anything. */
function SignedOutMenu({
  isUnconfigured,
  onSelectView,
}: {
  isUnconfigured: boolean;
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
              <LogIn className="h-3 w-3" />
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
            Guest mode
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onSelectView("settings")}
            className="gap-2"
          >
            <SettingsIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onSelectView("templates")}
            className="gap-2"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
            Templates
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
          {!isUnconfigured && (
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
