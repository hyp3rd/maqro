"use client";

import { dayTypeDescription, dayTypeLabel } from "@/lib/today/day-type";
import { cn } from "@/lib/utils";
import { Dumbbell, Moon } from "lucide-react";
import type { TrainingDayTargets } from "@maqro/core/targets";

/** The selected day's session (`DateTargets.training`): "Lower · heavy
 *  day", "Rest day" — the per-date override when the day has one, marked
 *  "changed" (calm, muted) so it never reads as the plan. Hidden while
 *  training is off (no `training`). Read-only by default; pass `onEdit` to
 *  make it the button that changes this day's session (`editLabel` names
 *  the action, e.g. "Change Wednesday’s session"). Brand chrome with
 *  foreground text, like the brand Badge: tone-coloured text on its own
 *  tint misses 4.5:1 in light mode. */
export function DayTypeChip({
  training,
  onEdit,
  editLabel = "Change this day’s session",
  className,
}: {
  training:
    Pick<TrainingDayTargets, "day" | "dayClass" | "overridden"> | undefined;
  /** Called with the chip itself: the sheet it opens has no Radix trigger,
   *  so it returns focus here explicitly (a click doesn't focus a button
   *  in Safari). */
  onEdit?: (trigger: HTMLButtonElement) => void;
  editLabel?: string;
  className?: string;
}) {
  if (!training) return null;
  const rest = training.day.type === "rest";
  const label = dayTypeLabel(training);
  const description = `${dayTypeDescription(training)}${
    training.overridden ? ", changed from the plan" : ""
  }`;
  const Icon = rest ? Moon : Dumbbell;
  const chrome = cn(
    "inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-label font-medium text-foreground coarse:min-h-11",
    rest ? "border-border bg-muted" : "border-brand/40 bg-brand/10",
    className,
  );
  const content = (
    <>
      <Icon
        aria-hidden
        className={cn(
          "h-4 w-4 shrink-0",
          rest ? "text-muted-foreground" : "text-brand-text",
        )}
      />
      <span>{label}</span>
      {training.overridden && <span className="font-normal">· changed</span>}
    </>
  );

  if (onEdit) {
    return (
      <button
        type="button"
        onClick={(event) => onEdit(event.currentTarget)}
        aria-haspopup="dialog"
        aria-label={`${description}. ${editLabel}`}
        className={cn(
          chrome,
          "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {content}
      </button>
    );
  }
  return (
    <p
      title={description}
      className={chrome}
    >
      {content}
    </p>
  );
}
