"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useState, useSyncExternalStore } from "react";
import { Activity, ChevronDown, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

/** Admin nav: page links + a live "active session" indicator +
 *  Exit-admin button.
 *
 *  Responsive shape:
 *    - Below lg (< 1024px): a single "Menu" dropdown trigger
 *      labelled with the current section name. Covers phone +
 *      tablet + narrow-desktop widths where 9 inline items would
 *      either get clipped at the right or visually collide with
 *      the ADMIN pill on the left (the original bug — at tablet
 *      widths "Overview" was sitting on top of the pill).
 *    - lg+ (≥ 1024px): the inline horizontal nav. 9 items fit
 *      comfortably here without scrolling.
 *
 *  The session indicator is small but load-bearing UX: it reminds
 *  the operator they're inside an audited surface and shows how
 *  long they've been in it. Updates every 30s client-side; precision
 *  past "X minutes" doesn't matter, but seeing the counter tick
 *  gives the indicator visible life.
 *
 *  "Exit admin" POSTs to /api/admin/session/end (closes the audit
 *  bracket with `reason='manual'`) then hard-navigates to /app. The
 *  Supabase auth session stays intact — the operator is still
 *  signed in to the consumer app, just no longer counted as "in
 *  the admin panel".
 *
 *  Active match uses prefix-equality at the segment level:
 *  `/admin/users/abc-123` highlights "Users", not "Overview".
 *  Overview (`/admin`) only matches on exact equality so it doesn't
 *  claim every page under it. */

type NavItem = { href: string; label: string; exact?: boolean };

const ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/onboarding", label: "Onboarding" },
  { href: "/admin/errors", label: "Errors" },
  { href: "/admin/webhooks", label: "Webhooks" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/social", label: "Social" },
  { href: "/admin/recipe-import-allowlist", label: "Import allowlist" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav({
  sessionStartedAt,
}: {
  /** Server-supplied ISO timestamp of the current admin
   *  session's start. Null when session-tracking is offline
   *  (Supabase unconfigured); the indicator hides cleanly. */
  sessionStartedAt: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const currentItem =
    ITEMS.find((i) => isActive(i.href, i.exact === true)) ?? ITEMS[0];

  async function exitAdmin() {
    haptic("tap");
    setExiting(true);
    try {
      const res = await clientFetch("/api/admin/session/end", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't close admin session.");
        return;
      }
      // Hard navigation — proxy.ts re-reads cookies on the next
      // request and the next render sees the user as signed in
      // (but no admin chrome). router.push would keep the cached
      // admin layout alive for a frame.
      window.location.assign("/app");
    } finally {
      setExiting(false);
    }
  }

  return (
    <>
      {/* Mobile: dropdown trigger shows the current section name so
       *  the operator always knows where they are even when the
       *  list is collapsed. */}
      <div className="flex items-center gap-1 lg:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11 coarse:px-3"
            aria-label="Admin navigation"
          >
            <Menu className="h-3.5 w-3.5" />
            <span className="max-w-[14ch] truncate">
              {currentItem?.label ?? "Menu"}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[200px]"
          >
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Admin
            </DropdownMenuLabel>
            {ITEMS.map((item) => {
              const active = isActive(item.href, item.exact === true);
              return (
                <DropdownMenuItem
                  key={item.href}
                  onSelect={() => router.push(item.href)}
                  className={`cursor-pointer text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {item.label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void exitAdmin()}
              disabled={exiting}
              className="cursor-pointer text-xs text-rose-700 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-400"
            >
              <LogOut className="mr-2 h-3 w-3" />
              {exiting ? "Exiting…" : "Exit admin"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* sm+: inline horizontal nav with session indicator + Exit
       *  button. The whole row is wrapped in an overflow guard so
       *  if a future operator adds a 12th nav item it scrolls
       *  rather than wrapping into the chrome above. */}
      <nav className="hidden items-center gap-2 overflow-x-auto text-xs lg:flex">
        {ITEMS.map((item) => {
          const active = isActive(item.href, item.exact === true);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative shrink-0 rounded-md px-2 py-1.5 transition-colors ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-[13px] h-px bg-foreground"
                />
              )}
            </Link>
          );
        })}
        <span
          aria-hidden
          className="mx-1 h-3 w-px shrink-0 bg-border/60"
        />
        {sessionStartedAt && <SessionIndicator startedAt={sessionStartedAt} />}
        <button
          type="button"
          onClick={() => void exitAdmin()}
          disabled={exiting}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          title="Close this admin session and return to the app"
        >
          <LogOut className="h-3 w-3" />
          Exit
        </button>
      </nav>
    </>
  );
}

/** Live "active for Xm Ys" pill. Uses useSyncExternalStore to
 *  subscribe to a 30s tick — the project's idiomatic pattern for
 *  "read from a mutable external source without breaking SSR"
 *  (same shape as PastDueBanner, ThemeToggle, etc.).
 *
 *  Server snapshot is `null` (renders "Active" with no duration)
 *  so SSR markup matches; the client commits a real timestamp on
 *  first mount and re-renders every 30s after. Hidden on small
 *  screens (already inside the `hidden lg:flex` nav) to keep the
 *  inline row tight. */
function SessionIndicator({ startedAt }: { startedAt: string }) {
  const now = useSyncExternalStore(subscribeTick, getNowSnapshot, () => null);
  const label =
    now === null ? "Active" : formatDuration(now - Date.parse(startedAt));

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400"
      title={`Admin session active since ${new Date(startedAt).toLocaleTimeString()}`}
    >
      <Activity className="h-3 w-3" />
      {label}
    </span>
  );
}

/** External-store wiring for `SessionIndicator`. Kept module-scope
 *  per React's contract — `useSyncExternalStore` requires stable
 *  function identity across renders.
 *
 *  Why the cached-snapshot pattern: React calls `getSnapshot`
 *  during every render and compares the result with the previous
 *  one via `Object.is`. Returning `Date.now()` raw produces a new
 *  value on every call (even within a single render), so React
 *  thinks the store is in constant flux and bails with "The result
 *  of getSnapshot should be cached to avoid an infinite loop".
 *  Caching the value and only updating it from inside the
 *  subscribe-side interval keeps `getSnapshot` stable between
 *  notifications.
 *
 *  Shared interval across subscribers: a single interval bumps
 *  one cached value and fans out to all subscribers, so two
 *  indicators (or future widgets that share this clock) don't
 *  multiply the wakeup count. */
const TICK_INTERVAL_MS = 30_000;

let cachedNow = 0;
const tickSubs = new Set<() => void>();
let tickIntervalId: number | null = null;

function subscribeTick(onChange: () => void): () => void {
  tickSubs.add(onChange);
  if (tickIntervalId === null) {
    cachedNow = Date.now();
    tickIntervalId = window.setInterval(() => {
      cachedNow = Date.now();
      for (const sub of tickSubs) sub();
    }, TICK_INTERVAL_MS);
  }
  return () => {
    tickSubs.delete(onChange);
    if (tickSubs.size === 0 && tickIntervalId !== null) {
      window.clearInterval(tickIntervalId);
      tickIntervalId = null;
    }
  };
}

function getNowSnapshot(): number {
  // Falls back to `Date.now()` only when subscribe hasn't seeded
  // the cache yet (first render before the first tick). The value
  // is then immediately stable for subsequent reads within the
  // same render.
  if (cachedNow === 0) cachedNow = Date.now();
  return cachedNow;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return "Just now";
  const totalMin = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m`;
  return `${hours}h ${min}m`;
}
