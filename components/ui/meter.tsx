import { formatNumber, roundTo, type ReadoutDecimals } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useLocale } from "next-intl";

export type MeterTone = "protein" | "carbs" | "fat" | "energy" | "neutral";

/** Fill and overshoot classes per tone. Overshoot is the SAME hue at lower
 *  intensity: visible, never a warning colour (wellbeing rule). Static
 *  strings so Tailwind can see them. */
const TONE: Record<MeterTone, { fill: string; overflow: string }> = {
  protein: { fill: "bg-macro-protein", overflow: "bg-macro-protein/40" },
  carbs: { fill: "bg-macro-carbs", overflow: "bg-macro-carbs/40" },
  fat: { fill: "bg-macro-fat", overflow: "bg-macro-fat/40" },
  energy: { fill: "bg-brand", overflow: "bg-brand/40" },
  neutral: { fill: "bg-foreground/70", overflow: "bg-foreground/30" },
};

/** Share of the bar the target occupies while intake is at or under it,
 *  leaving room to show a modest overshoot without rescaling. */
const TARGET_SHARE = 5 / 6;

export type MeterGeometry = {
  /** Target tick position, % of the bar; null when there is no target. */
  tick: number | null;
  /** Solid fill width up to the target, %. */
  fill: number;
  /** Overshoot segment width past the tick, %. */
  overflow: number;
};

/** Bar geometry for `value` against `target`. The scale is the larger of
 *  the target plus headroom and the value itself, so the bar is never
 *  clamped: 157% of target puts the tick at 1/1.57 of the width and draws
 *  the remaining 57% as overshoot. */
export function meterGeometry(value: number, target: number): MeterGeometry {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  if (!(Number.isFinite(target) && target > 0)) {
    return { tick: null, fill: 0, overflow: 0 };
  }
  const scale = Math.max(target / TARGET_SHARE, v);
  return {
    tick: (target / scale) * 100,
    fill: (Math.min(v, target) / scale) * 100,
    overflow: (Math.max(v - target, 0) / scale) * 100,
  };
}

export type MeterReading = {
  /** The value as shown: zero or more, rounded to the readout precision. */
  value: number;
  /** The target as shown, or null when it is not a positive figure. */
  target: number | null;
  /** Shown value minus shown target when that is positive, else 0. */
  over: number;
};

/** The figures a readout shows for `value` against `target`, rounded to
 *  `decimals` before anything is compared: over or under, and by how much,
 *  come from the same numbers as the figures on screen. 161.6 against
 *  160.4 shows "162 / 160" and so is 2 over, not the raw 1.2 ("+1"); 160.4
 *  against 160.2 shows "160 / 160" and is not over at all. */
export function meterReading(
  value: number,
  target: number | undefined,
  decimals: ReadoutDecimals,
): MeterReading {
  const shown = roundTo(
    Number.isFinite(value) && value > 0 ? value : 0,
    decimals,
  );
  const goal =
    target !== undefined && Number.isFinite(target)
      ? roundTo(target, decimals)
      : 0;
  if (!(goal > 0)) return { value: shown, target: null, over: 0 };
  return {
    value: shown,
    target: goal,
    over: Math.max(roundTo(shown - goal, decimals), 0),
  };
}

export type MeterProps = {
  value: number;
  target: number;
  tone?: MeterTone;
  /** Unit for the spoken reading ("g", "kcal"). */
  unit?: string;
  /** Formats figures in the spoken reading. Default: grouped for the app
   *  locale, at `decimals`. */
  format?: (n: number) => string;
  /** Precision of the figures: 0 (default), 1 or 2. Value and target are
   *  rounded to it before they are compared, drawn or formatted. Set it to
   *  match a custom `format`. */
  decimals?: ReadoutDecimals;
  className?: string;
} & (
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }
);

/** Value against a target, Instrument style: a thin track that ends at an
 *  explicit target tick, a solid fill up to it, and any overshoot continuing
 *  past the tick in the same hue at lower intensity. Over and under are
 *  shown, not judged.
 *
 *  ARIA `meter` (name required). `aria-valuemax` is the larger of target and
 *  value because the spec forbids `aria-valuenow` above the max; the target
 *  and any overshoot are spoken through `aria-valuetext`. Every figure, and
 *  the bar, uses the rounded `meterReading`, so the reading never disagrees
 *  with itself or with the figures beside it.
 *  https://www.w3.org/TR/wai-aria-1.2/#meter */
export function Meter({
  value,
  target,
  tone = "neutral",
  unit,
  format,
  decimals = 0,
  className,
  ...labelling
}: MeterProps) {
  const locale = useLocale();
  const show = format ?? ((n: number) => formatNumber(n, locale, decimals));
  const reading = meterReading(value, target, decimals);
  const geometry = meterGeometry(reading.value, reading.target ?? 0);
  const withUnit = (n: number) => (unit ? `${show(n)} ${unit}` : show(n));
  const valueText =
    reading.target !== null
      ? `${withUnit(reading.value)} of ${withUnit(reading.target)}${
          reading.over > 0 ? `, ${withUnit(reading.over)} above target` : ""
        }`
      : `${withUnit(reading.value)}, no target`;
  const classes = TONE[tone];

  return (
    <div
      role="meter"
      {...labelling}
      aria-valuemin={0}
      aria-valuemax={
        reading.target !== null
          ? Math.max(reading.target, reading.value)
          : reading.value
      }
      aria-valuenow={reading.value}
      aria-valuetext={valueText}
      className={cn("relative h-2 w-full", className)}
    >
      <span
        aria-hidden
        data-part="track"
        className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/10"
        style={{ width: `${geometry.tick ?? 100}%` }}
      />
      <span
        aria-hidden
        data-part="fill"
        className={cn(
          "absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full transition-[width] duration-500 ease-out",
          classes.fill,
        )}
        style={{ width: `${geometry.fill}%` }}
      />
      {geometry.overflow > 0 && geometry.tick !== null && (
        <span
          aria-hidden
          data-part="overflow"
          className={cn(
            "absolute top-1/2 h-1 -translate-y-1/2 rounded-r-full transition-[width] duration-500 ease-out",
            classes.overflow,
          )}
          style={{ left: `${geometry.tick}%`, width: `${geometry.overflow}%` }}
        />
      )}
      {geometry.tick !== null && (
        <span
          aria-hidden
          data-part="target"
          className="absolute inset-y-0 w-px -translate-x-1/2 bg-faint-foreground"
          style={{ left: `${geometry.tick}%` }}
        />
      )}
    </div>
  );
}
