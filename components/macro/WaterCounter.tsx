"use client";

import { useWaterIntake } from "@/hooks/use-water-intake";
import { BOTTLE_ML, GLASS_ML } from "@/lib/hydration";
import { formatVolume, type UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";
import { Droplets, Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";

/** Compact tap-to-log water counter for the day view. Shows the day's total
 *  against the goal with a progress bar, and quick-add buttons for a glass
 *  (250 ml) and a bottle (500 ml) plus a minus to undo. Storage is always
 *  ml; the labels render in the user's unit (ml or fl oz). The goal is the
 *  profile-derived value passed in by the caller. */
export function WaterCounter({
  date,
  goalMl,
  units,
}: {
  date: string;
  goalMl: number;
  units: UnitSystem;
}) {
  const { ml, loaded, addWater } = useWaterIntake(date);
  const pct = goalMl > 0 ? Math.min(100, Math.round((ml / goalMl) * 100)) : 0;
  const reached = ml >= goalMl && goalMl > 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Droplets className="h-4 w-4 text-sky-500" />
          Water
        </h3>
        <p className="font-mono text-sm tabular-nums text-muted-foreground">
          <span
            className={cn(
              "text-foreground",
              reached && "text-sky-600 dark:text-sky-400",
            )}
          >
            {loaded ? formatVolume(ml, units) : "—"}
          </span>
          <span className="mx-1 text-muted-foreground/50">/</span>
          {formatVolume(goalMl, units)}
          <span className="ml-2 text-xs text-muted-foreground/70">{pct}%</span>
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={ml}
        aria-valuemin={0}
        aria-valuemax={goalMl}
        aria-label="Water intake toward daily goal"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            reached ? "bg-sky-500" : "bg-sky-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={!loaded || ml <= 0}
          onClick={() => void addWater(-GLASS_ML)}
          aria-label={`Remove ${formatVolume(GLASS_ML, units)}`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 flex-1 gap-1.5"
          disabled={!loaded}
          onClick={() => void addWater(GLASS_ML)}
        >
          <Plus className="h-3.5 w-3.5" />
          {formatVolume(GLASS_ML, units)}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 flex-1 gap-1.5"
          disabled={!loaded}
          onClick={() => void addWater(BOTTLE_ML)}
        >
          <Plus className="h-3.5 w-3.5" />
          {formatVolume(BOTTLE_ML, units)}
        </Button>
      </div>
    </div>
  );
}
