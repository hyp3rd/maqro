"use client";

import { haptic } from "@/lib/haptics";
import { Camera, type LucideIcon, Mic, Plus } from "lucide-react";

/** Thumb-zone "Log meal" cluster for the meal log.
 *
 *  On mobile the dense inline AddFoodForm is hidden in favour of the
 *  guided LogMealSheet; the top-of-card "Log meal" button scrolls away
 *  as the user moves down a day's meals, so this cluster floats in the
 *  bottom-right thumb arc — just above the mobile tab bar — and opens
 *  the same sheet from anywhere in the list.
 *
 *  Camera + voice capture used to be buried two taps deep (Log meal →
 *  pick meal → pick method), so they weren't discoverable at a glance.
 *  They now sit as their own mini-FABs above the primary button. Both
 *  open mealless — the photo / voice review step is where the user picks
 *  the meal — so they're genuinely one tap. They only appear when AI is
 *  available (`onPhoto` / `onVoice` are omitted otherwise), matching the
 *  Photo / Voice methods' gating in the guided launcher.
 *
 *  Mobile-only (`md:hidden`, mirroring the bottom nav — desktop keeps
 *  the always-visible inline form plus sidebar). Rendered inside
 *  MealPlanner so it only appears on the meal-log view. */
export function QuickAddFab({
  onOpen,
  onPhoto,
  onVoice,
}: {
  onOpen: () => void;
  /** Mealless quick-capture entry points. Each is omitted when AI is
   *  unavailable, which hides that satellite. */
  onPhoto?: () => void;
  onVoice?: () => void;
}) {
  return (
    <div className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 flex flex-col items-center gap-2.5 md:hidden">
      {onVoice && (
        <SatelliteFab
          icon={Mic}
          label="Log a meal by voice"
          onClick={onVoice}
        />
      )}
      {onPhoto && (
        <SatelliteFab
          icon={Camera}
          label="Log a meal by photo"
          onClick={onPhoto}
        />
      )}
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onOpen();
        }}
        aria-label="Log meal"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/5 transition-transform duration-200 active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

/** Secondary capture button — smaller and lower-contrast than the primary
 *  FAB so the "Log meal" action stays dominant. */
function SatelliteFab({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onClick();
      }}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card text-foreground shadow-md transition-transform duration-200 active:scale-95"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
