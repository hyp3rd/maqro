import { formatNumber } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useLocale } from "next-intl";
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

export type MacroStatProps = {
  macro: MacroKey;
  value: number;
  /** When set, adds a Meter. A positive target also adds "/ target" and,
   *  past it, a neutral "+N"; zero or less (no goals yet) leaves the meter
   *  as an empty track that reads "no target", with no "/ 0" figure. */
  target?: number;
  /** Overrides the default label ("Protein", "Calories", ...). */
  label?: string;
  /** Formats the value, target and overshoot. Default: rounded, grouped
   *  for the app locale. */
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
  format,
  size,
  className,
  children,
}: MacroStatProps) {
  const locale = useLocale();
  const show = format ?? ((n: number) => formatNumber(n, locale));
  const spec = MACRO[macro];
  const name = label ?? spec.label;
  // Same rule as Meter: only a positive, finite target is something to
  // measure against, so the visible and spoken readouts agree.
  const hasTarget =
    target !== undefined && Number.isFinite(target) && target > 0;
  const overText =
    hasTarget && value > target ? show(value - target) : undefined;
  const showOver = overText !== undefined && overText !== show(0);

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
      value={children ?? show(value)}
      unit={spec.unit}
      detail={hasTarget ? `/ ${show(target)} ${spec.unit}` : undefined}
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
      {target !== undefined ? (
        <Meter
          aria-label={name}
          value={value}
          target={target}
          tone={spec.tone}
          unit={spec.unit}
          format={show}
          className="mt-0.5"
        />
      ) : undefined}
    </Stat>
  );
}
