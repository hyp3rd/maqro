"use client";

import { formatNumber } from "@/lib/i18n/number";
import {
  BEZEL,
  ENERGY_RING,
  GAUGE_CENTER,
  GAUGE_SIZE,
  MACRO_RINGS,
  bezelDash,
  gaugeCenter,
  plannedStroke,
  quarterMarksPath,
  ringArc,
  ringStrokes,
  targetIndexPath,
} from "@/lib/today/gauge";
import type { RelativeDay } from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";

type Macros = { calories: number; protein: number; carbs: number; fat: number };
type Targets = {
  targetCalories: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** Stroke classes per ring: the solid arc and its overshoot (the SAME hue
 *  at lower intensity — wellbeing rule: over is visible, never alarming).
 *  Static strings so Tailwind sees them. */
const TONE = {
  energy: { solid: "stroke-brand", over: "stroke-brand/40" },
  protein: { solid: "stroke-macro-protein", over: "stroke-macro-protein/40" },
  carbs: { solid: "stroke-macro-carbs", over: "stroke-macro-carbs/40" },
  fat: { solid: "stroke-macro-fat", over: "stroke-macro-fat/40" },
} as const;

/** Arcs ease to a new reading; the global reduced-motion rule
 *  (app/globals.css) makes the transition instant for users who asked. */
const ARC_MOTION =
  "transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out";

function Ring({
  name,
  value,
  planned = 0,
  target,
  radius,
  width,
}: {
  name: keyof typeof TONE;
  value: number;
  /** Food still planned on top of `value` (today): drawn dashed after it. */
  planned?: number;
  target: number;
  radius: number;
  width: number;
}) {
  const strokes = ringStrokes(ringArc(value, target, radius));
  const plan = plannedStroke(value, planned, target, radius);
  const circle = {
    cx: GAUGE_CENTER,
    cy: GAUGE_CENTER,
    r: radius,
    fill: "none",
    strokeWidth: width,
  };
  // Arcs start at 12 o'clock and run clockwise.
  const arc = {
    ...circle,
    transform: `rotate(-90 ${GAUGE_CENTER} ${GAUGE_CENTER})`,
  };
  return (
    <>
      <circle
        {...circle}
        className="stroke-foreground/[0.07]"
      />
      <circle
        {...arc}
        data-ring={name}
        data-part="solid"
        className={cn(TONE[name].solid, ARC_MOTION)}
        strokeDasharray={strokes.solid.dashArray}
        strokeDashoffset={strokes.solid.dashOffset}
      />
      {strokes.over && (
        <circle
          {...arc}
          data-ring={name}
          data-part="over"
          className={cn(TONE[name].over, ARC_MOTION)}
          strokeDasharray={strokes.over.dashArray}
          strokeDashoffset={strokes.over.dashOffset}
        />
      )}
      {plan && (
        <circle
          {...arc}
          data-ring={name}
          data-part="planned"
          className={TONE[name].over}
          strokeDasharray={plan.dashArray}
        />
      )}
    </>
  );
}

/** The Today calorie gauge (Instrument): a 60-tick bezel with quarter marks
 *  and a target index at 12 o'clock, the energy arc (eaten vs that day's
 *  own target) and three thin concentric macro arcs — protein outer, carbs,
 *  fat inner. Past a target an arc carries on beyond the index in the same
 *  hue at lower intensity. Today's planned food (`planned`) continues the
 *  energy arc in lighter dashes, up to the index. The centre says what is
 *  left of what was eaten, worded for the day (left today / under target /
 *  to plan) or a neutral "over".
 *
 *  The drawing is decorative (`aria-hidden`); the centre is a polite live
 *  region so logging food is announced, and the readout beside the gauge
 *  carries every figure. */
export function TodayGauge({
  eaten,
  planned,
  targets,
  when,
  className,
}: {
  eaten: Macros;
  /** Today's planned food (`dayIntake`), drawn on the energy arc. */
  planned?: Macros;
  targets: Targets;
  when: RelativeDay;
  className?: string;
}) {
  const locale = useLocale();
  const centre = gaugeCenter(eaten.calories, targets.targetCalories, when);
  const bezel = bezelDash();

  return (
    <div className={cn("relative aspect-square shrink-0", className)}>
      <svg
        viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
        aria-hidden="true"
        className="block h-full w-full"
      >
        <circle
          cx={GAUGE_CENTER}
          cy={GAUGE_CENTER}
          r={BEZEL.radius}
          fill="none"
          className="stroke-foreground/25"
          strokeWidth={BEZEL.width}
          strokeDasharray={bezel.dashArray}
          strokeDashoffset={bezel.dashOffset}
          transform={`rotate(-90 ${GAUGE_CENTER} ${GAUGE_CENTER})`}
        />
        <path
          d={quarterMarksPath()}
          fill="none"
          className="stroke-foreground/45"
          strokeWidth={1.5}
        />
        <Ring
          name="energy"
          value={eaten.calories}
          planned={planned?.calories}
          target={targets.targetCalories}
          radius={ENERGY_RING.radius}
          width={ENERGY_RING.width}
        />
        {(["protein", "carbs", "fat"] as const).map((macro) => (
          <Ring
            key={macro}
            name={macro}
            value={eaten[macro]}
            target={targets[macro]}
            radius={MACRO_RINGS[macro].radius}
            width={MACRO_RINGS[macro].width}
          />
        ))}
        <path
          d={targetIndexPath()}
          fill="none"
          className="stroke-foreground"
          strokeWidth={1.5}
        />
      </svg>
      <p
        role="status"
        aria-live="polite"
        className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-[22%] text-center"
      >
        {centre.figure !== null && (
          <>
            <span className="font-mono text-[1.75rem] font-medium leading-none tracking-tight tabular-nums text-foreground">
              {formatNumber(centre.figure, locale)}
            </span>{" "}
          </>
        )}
        <span
          className={cn(
            "leading-tight",
            centre.figure === null
              ? "text-sm font-medium text-foreground"
              : "text-xs text-muted-foreground",
          )}
        >
          {centre.label}
        </span>
      </p>
    </div>
  );
}
