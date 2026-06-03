"use client";

import { useFastingStatus } from "@/hooks/use-fasting-status";
import { formatDuration } from "@/lib/fasting";
import { Hourglass, Utensils } from "lucide-react";
import type { ViewKey } from "./Sidebar";

/** Persistent Topbar countdown chip — the fast status follows the user
 *  across every tab. Self-contained via `useFastingStatus` (it sits outside
 *  macro-calculator and can't receive its state), exactly like `StreakChip`.
 *  Renders nothing when fasting is off or there's no data. Clicking it opens
 *  the Fasting page via the `onSelectView` the Topbar already threads. Hidden
 *  below `sm` to keep the mobile bar uncrowded. */
export function FastingChip({
  onSelectView,
}: {
  onSelectView?: (key: ViewKey) => void;
}) {
  const { status, fasting, isHydrated } = useFastingStatus();

  if (!isHydrated || !fasting?.enabled || status.phase === "none") return null;

  const fastingPhase = status.phase === "fasting";

  return (
    <button
      type="button"
      onClick={() => onSelectView?.("fasting")}
      aria-label={
        fastingPhase
          ? `Fasting — eating window opens in ${formatDuration(status.remainingMin)} — open the Fasting page`
          : "Eating window open — open the Fasting page"
      }
      className="hidden h-8 items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40 sm:inline-flex"
    >
      {fastingPhase ? (
        <>
          <Hourglass
            className="h-3 w-3 text-indigo-500"
            aria-hidden
          />
          <span className="font-mono tabular-nums">
            {formatDuration(status.remainingMin)}
          </span>
        </>
      ) : (
        <>
          <Utensils
            className="h-3 w-3 text-emerald-500"
            aria-hidden
          />
          <span>Eating</span>
        </>
      )}
    </button>
  );
}
