"use client";

import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import * as React from "react";
import { Ellipsis, type LucideIcon, Plus } from "lucide-react";
import { motion } from "motion/react";
import { MoreSheet } from "./MoreSheet";
import { activeTabSlot, NAV, TAB_BAR, type ViewKey } from "./nav";

type Props = {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  /** The centre [+]: log something now. The parent switches to Today on
   *  today's date first, then opens the guided launcher. */
  onQuickAdd: () => void;
};

/** Mobile-only tab bar ("Instrument"): the slots come from the nav registry
 *  (`TAB_BAR`) — Today · Progress · [+] quick add · More · You. Translucent
 *  over the content with a hairline top edge; the active slot carries an
 *  LED-style indicator on that edge. Pinned to the viewport bottom, clear of
 *  the iOS home indicator via the safe-area inset. */
export function MobileBottomNav({ current, onSelect, onQuickAdd }: Props) {
  const lit = activeTabSlot(current);
  return (
    <nav
      aria-label="Primary navigation (mobile)"
      // Hook for app/globals.css: while this bar is mounted (and visible
      // below `md`) toasts are lifted above it via --toast-offset-bottom.
      data-mobile-bottom-nav=""
      className={cn(
        // Height: 6px top padding + 52px slots + 8px (plus the home-indicator
        // inset) below, plus the 1px hairline: ~67px in a browser tab.
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-center border-t border-border/60 bg-background/90 px-1.5 backdrop-blur-lg",
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
                onClick={() => {
                  haptic("tap");
                  onQuickAdd();
                }}
                className={cn(
                  // `brand-strong`, not `brand`: the token contract's fill
                  // behind a `brand-foreground` label (deeper in dark mode).
                  "inline-flex h-12 w-14 items-center justify-center rounded-2xl bg-brand-strong text-brand-foreground ring-4 ring-brand/15 transition-transform duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "motion-safe:active:scale-95",
                )}
              >
                <Plus
                  aria-hidden
                  className="size-6"
                  strokeWidth={2.2}
                />
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
