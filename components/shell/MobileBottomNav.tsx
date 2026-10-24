"use client";

import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import * as React from "react";
import { Ellipsis, LoaderCircle, type LucideIcon, Plus } from "lucide-react";
import { motion } from "motion/react";
import { MoreSheet } from "./MoreSheet";
import { activeTabSlot, NAV, TAB_BAR, type ViewKey } from "./nav";

type Props = {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  /** The centre [+]: log something now. The parent switches to Today on
   *  today's date first, then opens the guided launcher, returning focus to
   *  `trigger` (this button) when it closes. */
  onQuickAdd: (trigger: HTMLElement) => void;
  /** A quick add is waiting for today's log to load before the launcher
   *  opens (from another view or day): the [+] shows it is busy. */
  quickAddPending: boolean;
};

/** Mobile-only tab bar ("Instrument"): the slots come from the nav registry
 *  (`TAB_BAR`) — Today · Progress · [+] quick add · More · You. Translucent
 *  over the content with a hairline top edge; the active slot carries an
 *  LED-style indicator on that edge. Pinned to the viewport bottom, clear of
 *  the iOS home indicator via the safe-area inset. */
export function MobileBottomNav({
  current,
  onSelect,
  onQuickAdd,
  quickAddPending,
}: Props) {
  const lit = activeTabSlot(current);
  // aria-busy is immediate; the spinner waits, so a quick read keeps the
  // Plus instead of flashing a spinner for a few frames.
  const showSpinner = useAfterDelay(quickAddPending, SPINNER_DELAY_MS);
  return (
    <nav
      aria-label="Primary navigation (mobile)"
      // Hook for app/globals.css: while this bar is mounted (and visible
      // below `md`) toasts are lifted above it via --toast-offset-bottom.
      data-mobile-bottom-nav=""
      // One equal column per registry slot, so adding or dropping a slot
      // (the Suggestions change drops More) needs no edit here.
      style={{
        gridTemplateColumns: `repeat(${TAB_BAR.length}, minmax(0, 1fr))`,
      }}
      className={cn(
        // Height: 6px top padding + 52px slots + 8px (plus the home-indicator
        // inset) below, plus the 1px hairline: ~67px in a browser tab.
        "fixed inset-x-0 bottom-0 z-40 grid items-center border-t border-border/60 bg-background/90 px-1.5 backdrop-blur-lg",
        "pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:hidden",
      )}
    >
      {TAB_BAR.map((slot) => {
        if (slot === "quickAdd") {
          return (
            <div
              key={slot}
              className="flex items-center justify-center"
            >
              <button
                type="button"
                aria-label="Quick add"
                // It opens the launcher, a dialog.
                aria-haspopup="dialog"
                aria-busy={quickAddPending || undefined}
                data-pending={quickAddPending ? "true" : undefined}
                onClick={(event) => {
                  haptic("tap");
                  onQuickAdd(event.currentTarget);
                }}
                className={cn(
                  // `brand-strong`, not `brand`: the token contract's fill
                  // behind a `brand-foreground` label (deeper in dark mode).
                  "inline-flex h-12 w-14 items-center justify-center rounded-2xl bg-brand-strong text-brand-foreground ring-4 ring-brand/15 transition-transform duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "motion-safe:active:scale-95",
                )}
              >
                {showSpinner ? (
                  <LoaderCircle
                    aria-hidden
                    className="size-6 motion-safe:animate-spin"
                    strokeWidth={2.2}
                  />
                ) : (
                  <Plus
                    aria-hidden
                    className="size-6"
                    strokeWidth={2.2}
                  />
                )}
              </button>
            </div>
          );
        }
        if (slot === "more") {
          return (
            <MoreSheet
              key={slot}
              current={current}
              onSelect={onSelect}
            >
              <TabButton
                label="More"
                icon={Ellipsis}
                active={lit === "more"}
                onClick={() => haptic("select")}
              />
            </MoreSheet>
          );
        }
        const { shortLabel, icon } = NAV[slot];
        return (
          <TabButton
            key={slot}
            label={shortLabel}
            icon={icon}
            active={lit === slot}
            current={slot === current}
            onClick={() => {
              haptic("select");
              onSelect(slot);
            }}
          />
        );
      })}
    </nav>
  );
}

/** How long the [+] stays a Plus while busy before it shows a spinner:
 *  under it, today's log usually loads before the spinner would appear. */
const SPINNER_DELAY_MS = 200;

/** `active`, but only once it has held for `delayMs`; false again (and the
 *  wait restarts) as soon as it drops. */
function useAfterDelay(active: boolean, delayMs: number): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setHeld(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);
  // Reset during render (React's "storing information from previous
  // renders" pattern) so the next wait starts from zero.
  if (!active && held) setHeld(false);
  return active && held;
}

type TabButtonProps = Omit<
  React.ComponentPropsWithRef<"button">,
  "children"
> & {
  label: string;
  icon: LucideIcon;
  /** Lit: this slot is, or hosts, the open view. */
  active: boolean;
  /** This slot IS the open view (`aria-current="page"`); a slot that only
   *  hosts it (More, You) is lit without claiming to be the page. */
  current?: boolean;
};

/** One labelled tab. Forwards its ref and extra props (React 19 passes
 *  `ref` as a prop) so the More slot can be the sheet's Radix trigger. */
function TabButton({
  label,
  icon: Icon,
  active,
  current = false,
  className,
  ...buttonProps
}: TabButtonProps) {
  return (
    <button
      type="button"
      {...buttonProps}
      aria-current={current ? "page" : undefined}
      data-active={active ? "true" : undefined}
      className={cn(
        // ≥ 44px on every pointer: the slot is 52px tall and a fifth of the
        // bar wide. Phones have no hover; `active:` gives the press feedback.
        "relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:bg-foreground/5",
        active
          ? "font-semibold text-brand-text"
          : "font-medium text-muted-foreground",
        className,
      )}
    >
      {active && (
        // The LED: a short lit bar on the bar's top hairline. `-top-1.5`
        // cancels the bar's `pt-1.5` so it sits flush with the edge; the
        // shared layoutId slides it between tabs (skipped under reduced
        // motion by the app's MotionConfig).
        <motion.span
          aria-hidden
          layoutId="mobile-nav-led"
          className="absolute inset-x-0 -top-1.5 mx-auto h-0.5 w-5 rounded-b-sm bg-brand shadow-[0_0_8px_hsl(var(--brand)/0.7)]"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <Icon
        aria-hidden
        className="size-[22px]"
        strokeWidth={1.8}
      />
      <span>{label}</span>
    </button>
  );
}
