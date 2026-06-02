"use client";

import { Plus } from "lucide-react";

/** Thumb-zone "Log meal" button for the meal log.
 *
 *  On mobile the dense inline AddFoodForm is hidden in favour of the
 *  guided LogMealSheet; the top-of-card "Log meal" button scrolls away
 *  as the user moves down a day's meals, so this FAB floats in the
 *  bottom-right thumb arc — just above the mobile tab bar — and opens
 *  the same sheet from anywhere in the list. Logging is always one
 *  reachable tap away.
 *
 *  Mobile-only (`md:hidden`, mirroring the bottom nav — desktop keeps
 *  the always-visible inline form plus sidebar). Rendered inside
 *  MealPlanner so it only appears on the meal-log view. */
export function QuickAddFab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Log meal"
      className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/5 transition-transform duration-200 active:scale-95 md:hidden"
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
