"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  ChevronDown,
  LogOut,
  Settings,
  Shield,
  UserCircle2,
} from "lucide-react";
import Link from "next/link";

/** Landing-page user dropdown. Shown only when the server has already
 *  resolved a signed-in user (see SiteHeader in app/page.tsx); the
 *  email + admin flag are passed in so the menu doesn't need its own
 *  auth round-trip to render.
 *
 *  Entries: Open app (primary affordance), Admin panel (only when
 *  caller has the admin role — parity with the in-app UserMenu so
 *  admins can jump straight in from the marketing surface), Settings
 *  (deep-link into /app?view=settings — handled by the URL deep-link
 *  handler in macro-calculator.tsx), and Sign out.
 *
 *  Sign-out is the only action that touches the auth layer — wired
 *  client-side because the Supabase browser client owns the cookie
 *  refresh loop and a hard navigation to a server-side logout route
 *  would leave the SDK's in-memory state out of sync until next
 *  reload. After signOut() resolves we navigate back to / so the
 *  signed-out header re-renders on the next request. */
export function UserMenu({
  email,
  isAdmin = false,
}: {
  email: string;
  isAdmin?: boolean;
}) {
  async function signOut() {
    const supabase = getSupabaseBrowser();
    if (supabase) {
      await signOutAndClearLocal(supabase);
    }
    // Hard nav so the server-rendered header refreshes its
    // signed-in/out branch on the next request — `router.refresh()`
    // alone wouldn't re-run the cookie-bound server fetch reliably
    // across all browsers we ship to.
    window.location.assign("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Account menu for ${email}`}
      >
        <UserCircle2 className="h-3.5 w-3.5" />
        <span className="hidden max-w-[12ch] truncate sm:inline-block">
          {email}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px]"
      >
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            href="/app"
            className="cursor-pointer"
          >
            <UserCircle2 className="mr-2 h-3.5 w-3.5" />
            Open app
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link
              href="/admin"
              className="cursor-pointer"
            >
              <Shield className="mr-2 h-3.5 w-3.5" />
              Admin panel
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link
            href="/app?view=settings"
            className="cursor-pointer"
          >
            <Settings className="mr-2 h-3.5 w-3.5" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void signOut()}
          className="cursor-pointer text-rose-700 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-400"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
