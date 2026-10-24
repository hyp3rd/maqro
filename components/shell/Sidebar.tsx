"use client";

import { useIsAdmin } from "@/hooks/use-user-role";
import { cn } from "@/lib/utils";
import * as React from "react";
import { ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { LogoWordmark } from "./LogoWordmark";
import { UserMenu } from "./UserMenu";
import { NAV, SIDEBAR_GROUPS, type ViewKey } from "./nav";

const COLLAPSED_KEY = "maqro:sidebar-collapsed";

/** localStorage snapshot for `useSyncExternalStore`. Must return
 *  a stable value (no `Date.now()`, no `Math.random()`) so React's
 *  snapshot equality check works. The boolean shape is small
 *  enough that primitive equality holds - no caching needed. */
function getCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Server snapshot - must match the SSR-rendered markup. We
 *  always render the expanded state on the server; the post-
 *  hydration commit phase swaps to the localStorage preference. */
function getCollapsedServerSnapshot(): boolean {
  return false;
}

/** No-op subscribe. We don't actually need to react to cross-tab
 *  localStorage changes here - the sidebar's collapse pref is a
 *  per-tab UI nicety, not session-shared state. Providing an
 *  empty subscribe keeps `useSyncExternalStore` happy and avoids
 *  the React lint rule against setState-in-effect that the
 *  alternative useState + useEffect pattern triggered. */
function subscribeNoop(): () => void {
  return () => {};
}

type Props = { current: ViewKey; onSelect: (key: ViewKey) => void };

export function Sidebar({ current, onSelect }: Props) {
  const isAdmin = useIsAdmin();
  // SSR-safe persistence via useSyncExternalStore - the project's
  // idiomatic pattern for "read from a browser-only mutable
  // source without breaking SSR" (same pattern as PastDueBanner,
  // ThemeToggle, useNowEveryMinute).
  //
  // The server snapshot is always `false` (expanded), matching
  // the SSR-rendered markup. After hydration, React commits the
  // real localStorage value. The previous lazy-initializer
  // pattern read localStorage on the FIRST client render and
  // produced a hydration mismatch for users whose preference was
  // "collapsed" - React threw the tree away and regenerated it,
  // which is both louder in DevTools and slower than the brief
  // post-hydration swap this approach produces.
  const persistedCollapsed = React.useSyncExternalStore(
    subscribeNoop,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );
  // `manualOverride` lets the user toggle in-session without
  // racing the external-store snapshot. Once set, it wins until
  // the next mount.
  const [manualOverride, setManualOverride] = React.useState<boolean | null>(
    null,
  );
  const collapsed = manualOverride ?? persistedCollapsed;

  function toggle() {
    const next = !collapsed;
    setManualOverride(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage disabled - preference doesn't persist; the
      // current-session state still works via `manualOverride`.
    }
  }

  return (
    <aside
      aria-label="Primary navigation"
      // h-full + overflow-hidden + flex-col makes the inner <nav> the only
      // scrolling area, so the footer (UserMenu) stays pinned to the bottom
      // even with a long nav list. Parent (AppShell) is h-screen so this
      // resolves to viewport height.
      //
      // Width animates between expanded (240 px) and collapsed (56 px).
      // The transition is purely CSS - no Motion layout-id hop here,
      // because animating a `w-60` ↔ `w-14` transition is cheaper as a
      // direct width interpolation than as a layout-key swap.
      className={cn(
        "hidden h-full overflow-hidden transition-[width] duration-200 ease-out md:flex md:flex-col md:border-r md:border-border/60 md:bg-background",
        collapsed ? "md:w-14" : "md:w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b border-border/60",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        {/* Brand → landing. Same affordance as the mobile Topbar's
         *  mark and the landing-header lockup - clicking the brand
         *  anywhere in the chrome reliably gets you to the marketing
         *  page. The Link itself is the focus target; the inner
         *  mark/wordmark inherits color via currentColor. */}
        <Link
          href="/"
          aria-label="Maqro - visit homepage"
          className={cn(
            "inline-flex items-center text-foreground transition-opacity hover:opacity-80",
            collapsed ? "h-7 w-7 shrink-0 justify-center" : "flex-1",
          )}
        >
          {collapsed ? (
            // Collapsed rail: just the mark, set against a foreground
            // chip so the brand still pops in a 14 px-wide column.
            <span className="flex h-7 w-7 items-center justify-center rounded bg-foreground text-background">
              <LogoMark
                size={16}
                title=""
              />
            </span>
          ) : (
            // Expanded rail: full wordmark lockup. The previous
            // "mark-chip + Maqro text" pair was a workaround for not
            // having a real wordmark asset; now we have one, so use it
            // as the single brand signature.
            <LogoWordmark
              size={22}
              title=""
            />
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Collapse sidebar"
            className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        // Separate expand button below the brand chip - keeps the
        // collapsed state visually balanced and avoids a tiny chevron
        // hiding inside the brand row.
        <div className="flex h-9 shrink-0 items-center justify-center border-b border-border/60">
          <button
            type="button"
            onClick={toggle}
            aria-label="Expand sidebar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Grouped from the nav registry (./nav.ts). Each section is a
          labelled list; collapsed, the labels give way to a hairline so the
          grouping still reads in the 56 px rail. An unlabelled section after
          the first is set off by the same hairline. */}
      <nav className="flex-1 space-y-3 overflow-y-auto p-2">
        {SIDEBAR_GROUPS.map((group, i) => {
          const headingId = `sidebar-group-${group.id}`;
          return (
            <div
              key={group.id}
              role={group.label ? "group" : undefined}
              aria-labelledby={group.label ? headingId : undefined}
              className={cn(
                i > 0 &&
                  (collapsed || !group.label) &&
                  "border-t border-border/60 pt-3",
              )}
            >
              {group.label && !collapsed && (
                <p
                  id={headingId}
                  className="px-2.5 pb-1 text-xs font-medium text-faint-foreground"
                >
                  {group.label}
                </p>
              )}
              {group.label && collapsed && (
                <span
                  id={headingId}
                  className="sr-only"
                >
                  {group.label}
                </span>
              )}
              <ul className="space-y-0.5">
                {group.items.map((key) => (
                  <li key={key}>
                    <SidebarItem
                      viewKey={key}
                      active={key === current}
                      collapsed={collapsed}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {isAdmin && (
        <div className="shrink-0 border-t border-border/60 p-2">
          <Link
            href="/admin"
            title={collapsed ? "Admin" : undefined}
            // Muted by default so the link doesn't scream "danger
            // zone" at every page load. The accent dot is the only
            // affordance signaling this is an elevated section -
            // visible but quiet. Hover wakes the foreground color.
            className={cn(
              "group flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              collapsed ? "justify-center px-1.5" : "px-2.5",
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Admin</span>
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-foreground/40 transition-colors group-hover:bg-foreground"
                />
              </>
            )}
          </Link>
        </div>
      )}

      {!collapsed && (
        <div className="shrink-0 border-t border-border/60 p-2">
          <UserMenu />
        </div>
      )}
    </aside>
  );
}

function SidebarItem({
  viewKey,
  active,
  collapsed,
  onSelect,
}: {
  viewKey: ViewKey;
  active: boolean;
  collapsed: boolean;
  onSelect: (key: ViewKey) => void;
}) {
  const { label, icon: Icon } = NAV[viewKey];
  return (
    <button
      type="button"
      onClick={() => onSelect(viewKey)}
      // `title` provides the tooltip when collapsed - native browser
      // tooltip is fine here, no Radix needed for a power-user shortcut
      // affordance. Collapsed, the label is the accessible name too.
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        collapsed ? "justify-center px-1.5" : "px-2.5",
        active
          ? "text-brand-text"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-md bg-brand/10"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <Icon className="relative h-4 w-4 shrink-0" />
      {!collapsed && <span className="relative flex-1 text-left">{label}</span>}
    </button>
  );
}
