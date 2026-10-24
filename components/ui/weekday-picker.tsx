"use client";

import { cn } from "@/lib/utils";
import * as React from "react";

/** Day names indexed by JS `Date.getDay()` (0 = Sunday): the convention
 *  MealSchedule.daysOfWeek and SupplementSchedule.daysOfWeek store. */
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Display order: the week starts on Monday. Values keep getDay numbers. */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

export type WeekdayPickerProps = {
  /** Selected days as `getDay()` numbers (0 = Sunday ... 6 = Saturday). */
  value: readonly number[];
  /** The next selection, de-duplicated and sorted ascending (0 first). */
  onValueChange: (days: number[]) => void;
  disabled?: boolean;
  className?: string;
} & (
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }
);

/** Seven day toggles (`aria-pressed` buttons in a named group), Monday
 *  first. Each is a native button, so Tab moves between days and Space or
 *  Enter toggles one; the accessible name is the full day ("Monday") and the
 *  visible label its abbreviation. Days share the row equally and are 36px
 *  tall on a precise pointer, 44px on a finger. */
export function WeekdayPicker({
  value,
  onValueChange,
  disabled,
  className,
  ...labelling
}: WeekdayPickerProps) {
  const selected = new Set(value);

  const toggle = (dow: number) => {
    const next = new Set(selected);
    if (next.has(dow)) next.delete(dow);
    else next.add(dow);
    onValueChange([...next].sort((a, b) => a - b));
  };

  return (
    <div
      role="group"
      {...labelling}
      className={cn("grid grid-cols-7 gap-1", className)}
    >
      {MONDAY_FIRST.map((dow) => {
        const on = selected.has(dow);
        const name = DAY_NAMES[dow];
        return (
          <button
            key={dow}
            type="button"
            aria-pressed={on}
            aria-label={name}
            disabled={disabled}
            onClick={() => toggle(dow)}
            className={cn(
              "inline-flex h-touch-9 min-w-0 items-center justify-center rounded-md border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
              on
                ? "border-brand/45 bg-brand/15 font-semibold text-foreground"
                : "border-border font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {name.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}
