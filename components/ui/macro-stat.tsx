import { cn } from "@/lib/utils";
import * as React from "react";
import { Meter, type MeterTone } from "./meter";
import { Stat, type StatProps } from "./stat";

export type MacroKey = "calories" | "protein" | "carbs" | "fat";

const MACRO: Record<
  MacroKey,
  { label: string; unit: string; tone: MeterTone; swatch: string }
> = {
  calories: {
    label: "Calories",
    unit: "kcal",
    tone: "energy",
    swatch: "bg-brand",
  },
  protein: {
    label: "Protein",
    unit: "g",
    tone: "protein",
    swatch: "bg-macro-protein",
  },
  carbs: { label: "Carbs", unit: "g", tone: "carbs", swatch: "bg-macro-carbs" },
  fat: { label: "Fat", unit: "g", tone: "fat", swatch: "bg-macro-fat" },
};

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

export type MacroStatProps = {
  macro: MacroKey;
  value: number;
  /** When set, adds "/ target", a Meter and, past it, a neutral "+N". */
  target?: number;
  /** Overrides the default label ("Protein", "Calories", ...). */
  label?: string;
  /** Formats the value, target and overshoot. Default: rounded, grouped. */
  format?: (n: number) => string;
  size?: StatProps["size"];
  className?: string;
  /** Replaces the formatted figure (e.g. an animated ticker); `value` still
   *  drives the meter and its reading. */
  children?: React.ReactNode;
};

/** One macro readout: colour swatch + label, the figure and unit, and when
 *  a target is given, "/ target" plus a Meter. Over target shows a quiet
 *  "+N" in the secondary text colour and the meter's same-hue overshoot -
 *  visible, never red or alarming. Place inside a `<dl>`. */
export function MacroStat({
  macro,
  value,
  target,
  label,
  format = defaultFormat,
  size,
  className,
  children,
}: MacroStatProps) {
  const spec = MACRO[macro];
  const name = label ?? spec.label;
  const hasTarget = target !== undefined;
  const overText =
    hasTarget && value > target ? format(value - target) : undefined;
  const showOver = overText !== undefined && overText !== format(0);

  return (
    <Stat
      className={className}
      size={size}
      label={
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("h-1 w-2.5 shrink-0 rounded-full", spec.swatch)}
          />
          {name}
        </span>
      }
      value={children ?? format(value)}
      unit={spec.unit}
      detail={hasTarget ? `/ ${format(target)} ${spec.unit}` : undefined}
      note={
        showOver ? (
          // The meter speaks the overshoot; this is its visible twin.
          <span
            aria-hidden
            className="text-xs font-medium text-muted-foreground"
          >
            +{overText}
          </span>
        ) : undefined
      }
    >
      {hasTarget ? (
        <Meter
          aria-label={name}
          value={value}
          target={target}
          tone={spec.tone}
          unit={spec.unit}
          format={format}
          className="mt-0.5"
        />
      ) : undefined}
    </Stat>
  );
}
