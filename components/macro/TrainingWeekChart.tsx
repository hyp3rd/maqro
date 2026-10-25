"use client";

import { useElementWidth } from "@/hooks/use-element-width";
import { formatNumber } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import { motion, useReducedMotionConfig } from "motion/react";
import { useLocale } from "next-intl";

export type ChartDay = {
  /** `getDay()` (0 = Sunday). */
  weekday: number;
  /** Short visible label ("Mon") and the full name for the table. */
  short: string;
  name: string;
  kcal: number;
  /** A session day (drawn in the brand hue) vs a rest day (neutral). */
  training: boolean;
  today: boolean;
};

type Props = {
  /** Monday first. */
  days: readonly ChartDay[];
  /** The weekly average every bar diverges from. */
  mean: number;
  /** The safety floor (kcal) no planned day goes under. */
  floor: number;
  className?: string;
};

const HEIGHT = 148;
const LABEL_GUTTER = 64;
const TOP = 18; // room for a delta label above the tallest bar
const BOTTOM = 40; // delta label below the deepest bar + day labels
const MIN_SCALE = 100; // kcal: a flat week still has a readable scale
/** Draw the floor line only while it sits within this many "largest
 *  shifts" below the average; further down it would flatten every bar. */
const FLOOR_RANGE = 2;
/** The floor line also needs this many px under the average line: closer,
 *  the two gutter labels would overlap (the floor sentence under the chart
 *  still gives the figure). */
const MIN_LINE_GAP = 16;
/** A delta label's 12 px mono figure: its ink above and below the
 *  baseline, and the clear room it keeps from the dashed floor line (its
 *  card-coloured halo is 2 px of that). */
const LABEL_ASCENT = 9;
const LABEL_DESCENT = 3;
const LABEL_LINE_CLEAR = 4;
/** A below-the-average label's baseline: just under its bar, else — where
 *  that would put the figure on the floor line (a bar ending just above
 *  it) — just under the line, so the two never cross. */
function belowLabelBaseline(barBottom: number, floorY: number | null) {
  const baseline = barBottom + 13;
  if (
    floorY === null ||
    baseline - LABEL_ASCENT - LABEL_LINE_CLEAR >= floorY ||
    baseline + LABEL_DESCENT + LABEL_LINE_CLEAR <= floorY
  )
    return baseline;
  return floorY + LABEL_LINE_CLEAR + LABEL_ASCENT;
}

/** Signed, grouped kcal difference: "+300", "−250", "0". */
function signed(n: number, locale: string): string {
  if (n === 0) return formatNumber(0, locale);
  return `${n > 0 ? "+" : "−"}${formatNumber(Math.abs(n), locale)}`;
}

/** The diverging "calorie shift" chart: each planned day as a bar above or
 *  below the weekly average (training days in the brand hue, rest days
 *  neutral), with the safety floor as a dashed line when it is in range
 *  and far enough under the average to read as its own line.
 *  The bars above and below visibly balance: calories move between days,
 *  never on top.
 *
 *  The SVG is decorative to assistive tech; a visually hidden table carries
 *  the same figures (day, planned kcal, difference from the average). */
export function TrainingWeekChart({ days, mean, floor, className }: Props) {
  const locale = useLocale();
  const reduceMotion = useReducedMotionConfig() === true;
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const deltas = days.map((d) => d.kcal - mean);
  const largest = Math.max(MIN_SCALE, ...deltas.map((d) => Math.abs(d)));
  const floorGap = mean - floor;
  const floorInRange = floorGap > 0 && floorGap <= FLOOR_RANGE * largest;
  const below = floorInRange ? Math.max(largest, floorGap) : largest;
  const plotH = HEIGHT - TOP - BOTTOM;
  const perKcal = plotH / (largest + below);
  const avgY = TOP + largest * perKcal;
  const floorY = avgY + floorGap * perKcal;
  // Hiding a too-close floor never rescales: it sits within `largest`.
  const showFloor = floorInRange && floorY - avgY >= MIN_LINE_GAP;

  const plotW = Math.max(0, (width ?? 0) - LABEL_GUTTER);
  const col = plotW / Math.max(1, days.length);
  const barW = Math.min(24, Math.max(8, col * 0.42));
  const transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 260, damping: 30 };

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={ref}
        className="h-[148px] w-full"
      >
        {width !== null && width > LABEL_GUTTER && (
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            aria-hidden
            className="block overflow-visible"
          >
            <text
              x={0}
              y={avgY}
              dy="0.35em"
              className="fill-muted-foreground text-label"
            >
              Average
            </text>
            <line
              x1={LABEL_GUTTER - 6}
              x2={width}
              y1={avgY}
              y2={avgY}
              className="stroke-border"
              strokeWidth={1}
            />
            {showFloor && (
              <>
                <text
                  x={0}
                  y={floorY}
                  dy="0.35em"
                  className="fill-muted-foreground text-label"
                >
                  Floor
                </text>
                <line
                  x1={LABEL_GUTTER - 6}
                  x2={width}
                  y1={floorY}
                  y2={floorY}
                  className="stroke-muted-foreground/60"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              </>
            )}
            {days.map((d, i) => {
              const delta = deltas[i] ?? 0;
              const cx = LABEL_GUTTER + col * (i + 0.5);
              // A flat day still shows a 2px tick on the average line.
              const h = Math.max(2, Math.abs(delta) * perKcal);
              const y = delta >= 0 ? avgY - h : avgY;
              return (
                <g key={d.weekday}>
                  <title>{`${d.name}: ${formatNumber(d.kcal, locale)} kcal (${signed(delta, locale)})`}</title>
                  <motion.rect
                    x={cx - barW / 2}
                    width={barW}
                    rx={3}
                    initial={false}
                    animate={{ y, height: h }}
                    transition={transition}
                    className={
                      d.training ? "fill-brand" : "fill-muted-foreground/45"
                    }
                  />
                  {delta !== 0 && (
                    <text
                      x={cx}
                      y={
                        delta > 0
                          ? y - 5
                          : belowLabelBaseline(y + h, showFloor ? floorY : null)
                      }
                      textAnchor="middle"
                      // A card-coloured halo keeps the figure crisp next
                      // to a bar or a line it passes close to.
                      paintOrder="stroke"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      className="fill-muted-foreground stroke-card font-mono text-xs tabular-nums"
                    >
                      {signed(delta, locale)}
                    </text>
                  )}
                  <text
                    x={cx}
                    y={HEIGHT - 4}
                    textAnchor="middle"
                    className={cn(
                      "text-label",
                      d.today
                        ? "fill-brand-text font-semibold"
                        : "fill-muted-foreground",
                    )}
                  >
                    {d.short}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <table className="sr-only">
        <caption>
          Planned calories by day, around your {formatNumber(mean, locale)} kcal
          average
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Planned kcal</th>
            <th scope="col">Difference from average</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d.weekday}>
              <th scope="row">
                {d.name}
                {d.today ? " (today)" : ""}
              </th>
              <td>{formatNumber(d.kcal, locale)}</td>
              <td>{signed(deltas[i] ?? 0, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
