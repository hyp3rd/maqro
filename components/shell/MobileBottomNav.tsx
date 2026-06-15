"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import {
  Apple,
  Calculator,
  ChefHat,
  LineChart,
  ShoppingCart,
  Utensils,
} from "lucide-react";
import { motion } from "motion/react";
import type { ViewKey } from "./Sidebar";

type NavItem = {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Six primary destinations. Templates + Settings used to live here
// too, but eight slots on a 375 px viewport crammed icons against
// labels and made the row read as "any of these is equally
// important", which they're not. The two displaced items now live
// in the avatar dropdown (mobile-only), one tap away from any
// screen — see [UserMenu.tsx](./UserMenu.tsx).
const NAV: NavItem[] = [
  { key: "calculator", label: "Calc", icon: Calculator },
  { key: "plan", label: "Plan", icon: Utensils },
  { key: "progress", label: "Progress", icon: LineChart },
  { key: "foods", label: "Foods", icon: Apple },
  { key: "recipes", label: "Recipes", icon: ChefHat },
  { key: "shopping", label: "Shop", icon: ShoppingCart },
];

type Props = { current: ViewKey; onSelect: (key: ViewKey) => void };

/** Mobile-only bottom tab bar. Mirrors the desktop sidebar nav so users
 * on small screens can still navigate. Pinned to the viewport bottom with
 * a backdrop so it stays out of the content scroll. The `pb-[…safe-area]`
 * trick keeps it clear of the iOS home-indicator notch. */
export function MobileBottomNav({ current, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary navigation (mobile)"
      className={cn(
        // Padding works on both ends:
        //
        //   - `pt-3` (12 px) - visible breathing room at the top
        //     so the icons don't sit flush against the top border.
        //   - `pb-[calc(env(safe-area-inset-bottom)+0.75rem)]`
        //     (~46 px on iPhone PWA, 12 px in the browser) - covers
        //     the iOS home-indicator zone AND adds visible padding
        //     above it so labels aren't flush with the indicator
        //     pill. In the browser this just resolves to 12 px,
        //     giving symmetric top/bottom rhythm.
        //
        // We dropped `min-h-14` because the icon+label group
        // (~34 px) + the explicit padding now drives the bar
        // height naturally:
        //   - Browser:    12 + 34 + 12 = 58 px
        //   - iPhone PWA: 12 + 34 + 46 = 92 px (matches native
        //                                       iOS tab-bar feel)
        //
        // Saturated background so titles below don't bleed through
        // the blur on light pages.
        "fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border/60 bg-background/95 backdrop-blur",
        "pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden",
      )}
    >
      {NAV.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === current;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={cn(
              // Phones have no hover state - use `active:` for the
              // pressed visual instead so users get instant tactile
              // feedback when their thumb lands on the target.
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "active:bg-foreground/5",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {isActive && (
              <motion.span
                layoutId="mobile-nav-active"
                // `-top-3` pulls the indicator up by the nav's
                // `pt-3` so it sits flush with the nav's top
                // border - the `rounded-b` (bottom-rounded
                // only) styling was originally designed to hang
                // off the top edge like a tab bookmark. With
                // plain `top-0` the indicator landed at the top
                // of the button, which after the pt-3 sat 12 px
                // below the nav border and read as floating.
                className="absolute inset-x-3 -top-3 h-0.5 rounded-b bg-foreground"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
