import { cn } from "@/lib/utils";
import * as React from "react";

const VALUE_SIZE = { sm: "text-sm", md: "text-lg", lg: "text-xl" } as const;

export type StatProps = {
  /** Sentence-case label (13px, secondary colour). */
  label: React.ReactNode;
  /** The figure, drawn in tabular mono so digits do not dance. */
  value: React.ReactNode;
  /** Unit after the figure ("g", "kcal"), smaller and secondary. */
  unit?: React.ReactNode;
  /** Secondary reading at the end of the label row, e.g. "/ 160 g". */
  detail?: React.ReactNode;
  /** Quiet trailing note after the figure, e.g. "+12". */
  note?: React.ReactNode;
  size?: keyof typeof VALUE_SIZE;
  className?: string;
  /** Extra content below the figure (a Meter, a caption). */
  children?: React.ReactNode;
};

/** A label + figure readout. Renders a `<div>` holding only `<dt>`/`<dd>`
 *  elements, so place it inside a `<dl>`: assistive tech then announces each
 *  label with its value. Layout is a two-column grid: label and `detail` on
 *  the first row, the figure (and `children`) spanning below. */
export function Stat({
  label,
  value,
  unit,
  detail,
  note,
  size = "md",
  className,
  children,
}: StatProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1",
        className,
      )}
    >
      <dt className="min-w-0 truncate text-label font-medium text-muted-foreground">
        {label}
      </dt>
      {detail !== undefined && (
        <dd className="font-mono text-xs tabular-nums text-muted-foreground">
          {detail}
        </dd>
      )}
      <dd
        className={cn(
          "col-span-2 font-mono font-semibold tabular-nums leading-tight text-foreground",
          VALUE_SIZE[size],
        )}
      >
        {value}
        {unit !== undefined && (
          <>
            {" "}
            <span className="text-xs font-medium text-muted-foreground">
              {unit}
            </span>
          </>
        )}
        {note !== undefined && <> {note}</>}
      </dd>
      {children !== undefined && <dd className="col-span-2">{children}</dd>}
    </div>
  );
}
