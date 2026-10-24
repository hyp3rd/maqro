"use client";

import { cn } from "@/lib/utils";
import * as React from "react";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "role" | "aria-checked" | "onChange" | "value"
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** On/off control: a native `<button role="switch" aria-checked>`, so Tab
 *  focuses it and Space/Enter toggle it with no key handling of our own,
 *  and a `<Label htmlFor>` both names and toggles it.
 *  https://www.w3.org/WAI/ARIA/apg/patterns/switch/
 *
 *  The button is the hit area: 44px wide, and 28px tall on a precise pointer
 *  (the track itself) or 44px on a finger with the track centred. A caller's
 *  `onClick` runs first and can `preventDefault()` to veto the toggle. */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, onClick, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        "group relative inline-flex h-touch-7 w-11 shrink-0 cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none flex h-7 w-11 items-center rounded-full border p-0.5 transition-colors",
          checked ? "border-brand bg-brand" : "border-input bg-muted",
        )}
      >
        <span
          className={cn(
            "block size-5.5 rounded-full shadow-sm transition-transform",
            checked
              ? "translate-x-4 bg-brand-foreground"
              : "translate-x-0 bg-muted-foreground",
          )}
        />
      </span>
    </button>
  ),
);
Switch.displayName = "Switch";

export { Switch };
