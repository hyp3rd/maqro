"use client";

import { cn } from "@/lib/utils";
import * as React from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  className?: string;
} & (
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }
);

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/** One-of-N choice drawn as equal segments (the Instrument "Off / Modest /
 *  Pronounced" control). WAI-ARIA radio group: Tab enters on the checked
 *  radio (or on the first enabled one when none matches or the checked one
 *  is disabled, since a disabled button cannot take focus), the arrow keys
 *  move focus and check the adjacent radio, wrapping at the ends and
 *  skipping disabled options, and Space or a click checks the focused radio.
 *  https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 *
 *  Each segment is 36px tall on a precise pointer and 44px on a finger. */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...labelling
}: SegmentedControlProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const firstEnabled = options.findIndex((o) => !o.disabled);
  const tabStop =
    checkedIndex >= 0 && !options[checkedIndex]?.disabled
      ? checkedIndex
      : firstEnabled;

  const onKeyDown = (event: React.KeyboardEvent, from: number) => {
    const step = NEXT_KEYS.has(event.key)
      ? 1
      : PREV_KEYS.has(event.key)
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    for (let i = 1; i <= options.length; i++) {
      const at = (from + step * i + options.length) % options.length;
      const option = options[at];
      if (option && !option.disabled) {
        refs.current[at]?.focus();
        onValueChange(option.value);
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      {...labelling}
      className={cn("grid auto-cols-fr grid-flow-col gap-1.5", className)}
    >
      {options.map((option, index) => {
        const checked = index === checkedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-touch-9 min-w-0 items-center justify-center rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
              checked
                ? "border-brand/45 bg-brand/15 font-semibold text-foreground"
                : "border-border font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
