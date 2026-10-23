import { formatNumber } from "@/lib/i18n/number";
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

export type MeterProps = {
  value: number;
  target: number;
  tone?: MeterTone;
  /** Unit for the spoken reading ("g", "kcal"). */
  unit?: string;
  /** Formats figures in the spoken reading. Default: rounded, grouped
   *  for the app locale. */
  format?: (n: number) => string;
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
 *  and any overshoot are spoken through `aria-valuetext`.
 *  https://www.w3.org/TR/wai-aria-1.2/#meter */
export function Meter({
  value,
  target,
  tone = "neutral",
  unit,
  format,
  className,
  ...labelling
}: MeterProps) {
  const locale = useLocale();
  const show = format ?? ((n: number) => formatNumber(n, locale));
  const now = Number.isFinite(value) && value > 0 ? value : 0;
  const hasTarget = Number.isFinite(target) && target > 0;
  const geometry = meterGeometry(now, target);
  const withUnit = (n: number) => (unit ? `${show(n)} ${unit}` : show(n));
  // An overshoot that formats to zero ("0 g above target") is noise: skip
  // it, as MacroStat skips its visible "+N".
  const overshoot = hasTarget ? now - target : 0;
  const spokenOver = overshoot > 0 && show(overshoot) !== show(0);
  const valueText = hasTarget
    ? `${withUnit(now)} of ${withUnit(target)}${
        spokenOver ? `, ${withUnit(overshoot)} above target` : ""
      }`
    : `${withUnit(now)}, no target`;
  const classes = TONE[tone];

  return (
    <div
      role="meter"
      {...labelling}
      aria-valuemin={0}
      aria-valuemax={hasTarget ? Math.max(target, now) : now}
      aria-valuenow={now}
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
