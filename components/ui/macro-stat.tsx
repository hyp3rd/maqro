import { formatNumber, type ReadoutDecimals } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useLocale } from "next-intl";
import { Meter, meterReading, type MeterTone } from "./meter";
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
  /** When set, adds a Meter. A target that rounds to a positive figure also
   *  adds "/ target" and, past it, a neutral "+N"; zero or less (no goals
   *  yet) leaves the meter as an empty track that reads "no target", with
   *  no "/ 0" figure. */
  target?: number;
  /** Overrides the default label ("Protein", "Calories", ...). */
  label?: string;
  /** Formats the value, target and overshoot. Default: grouped for the app
   *  locale, at `decimals`. */
  format?: (n: number) => string;
  /** Precision of the figures: 0 (default), 1 or 2. Over/under and the
   *  "+N" are worked out on value and target rounded to it, so they match
   *  the figures shown. Set it to match a custom `format`. */
  decimals?: ReadoutDecimals;
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
  decimals = 0,
  size,
  className,
  children,
}: MacroStatProps) {
  const locale = useLocale();
  const show = format ?? ((n: number) => formatNumber(n, locale, decimals));
  const spec = MACRO[macro];
  const name = label ?? spec.label;
  // The same rounded reading the Meter speaks: "/ target" and "+N" are the
  // figures it says, and "+N" is always the shown value minus the shown
  // target.
  const reading = meterReading(value, target, decimals);

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
      detail={
        reading.target !== null
          ? `/ ${show(reading.target)} ${spec.unit}`
          : undefined
      }
      note={
        reading.over > 0 ? (
          // The meter speaks the overshoot; this is its visible twin.
          <span
            aria-hidden
            className="text-xs font-medium text-muted-foreground"
          >
            +{show(reading.over)}
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
          decimals={decimals}
          className="mt-0.5"
        />
      ) : undefined}
    </Stat>
  );
}
