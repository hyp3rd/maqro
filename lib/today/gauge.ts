import type { RelativeDay } from "./timeline";

/** Geometry of the Today ring gauge, in a 200 × 200 viewBox centred on
 *  (100, 100). Every ring starts at 12 o'clock (the drawing rotates the
 *  circles by −90°) and runs clockwise. Pure: no DOM, so the arcs are unit
 *  tested and reusable by a native client.
 *
 *  Rings, outside in: a 60-tick bezel with quarter marks; the energy arc
 *  (eaten vs that day's own target); three thin macro arcs (protein, carbs,
 *  fat). A target index sits at 12 o'clock: where every arc meets its
 *  target, and where an overshoot carries on past it. */

export const GAUGE_SIZE = 200;
export const GAUGE_CENTER = GAUGE_SIZE / 2;

export const BEZEL = {
  radius: 97.5,
  ticks: 60,
  tickLength: 0.9,
  width: 3,
} as const;
export const ENERGY_RING = { radius: 88, width: 8 } as const;
export const MACRO_RINGS = {
  protein: { radius: 77, width: 3 },
  carbs: { radius: 71, width: 3 },
  fat: { radius: 65, width: 3 },
} as const;

export function circumference(radius: number): number {
  return 2 * Math.PI * radius;
}

/** Stroke lengths of one ring for `value` against `target`.
 *  `fill` runs from the index up to the target (at most one lap); `over`
 *  is how far an overshoot continues past the index, drawn in the same hue
 *  at lower intensity and capped at one more lap. Over and under are shown,
 *  never clamped away and never judged. No positive target (or no intake)
 *  → nothing drawn. */
export type RingArc = { circumference: number; fill: number; over: number };

export function ringArc(
  value: number,
  target: number,
  radius: number,
): RingArc {
  const c = circumference(radius);
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  if (!(Number.isFinite(target) && target > 0)) {
    return { circumference: c, fill: 0, over: 0 };
  }
  const ratio = v / target;
  return {
    circumference: c,
    fill: Math.min(ratio, 1) * c,
    over: Math.min(Math.max(ratio - 1, 0), 1) * c,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `stroke-dasharray` drawing the first `length` of a ring and leaving the
 *  rest of the lap empty. */
export function dashArray(length: number, ringCircumference: number): string {
  return `${round3(length)} ${round3(ringCircumference)}`;
}

/** The bezel's 60 tick marks as a dash pattern, offset so the first tick
 *  is centred on 12 o'clock. */
export function bezelDash(): { dashArray: string; dashOffset: number } {
  const period = circumference(BEZEL.radius) / BEZEL.ticks;
  return {
    dashArray: `${BEZEL.tickLength} ${round3(period - BEZEL.tickLength)}`,
    dashOffset: BEZEL.tickLength / 2,
  };
}

const BEZEL_OUTER = GAUGE_CENTER - BEZEL.radius - BEZEL.width / 2; // 1
const QUARTER_LENGTH = 6;

/** Longer marks at 3, 6 and 9 o'clock on the bezel (12 o'clock carries
 *  the target index). */
export function quarterMarksPath(): string {
  const outer = GAUGE_SIZE - BEZEL_OUTER;
  const inner = outer - QUARTER_LENGTH;
  return [
    `M${inner} ${GAUGE_CENTER}H${outer}`,
    `M${GAUGE_CENTER} ${inner}V${outer}`,
    `M${BEZEL_OUTER} ${GAUGE_CENTER}H${BEZEL_OUTER + QUARTER_LENGTH}`,
  ].join("");
}

/** The target index: a vertical line at 12 o'clock from the bezel's outer
 *  edge down through the energy ring. */
export function targetIndexPath(): string {
  const end = GAUGE_CENTER - ENERGY_RING.radius + ENERGY_RING.width / 2 + 1;
  return `M${GAUGE_CENTER} ${BEZEL_OUTER}V${end}`;
}

/** The figure and words in the middle of the gauge. Rounded before
 *  comparing, so the words agree with the figure. Wording follows the day:
 *  today has kcal "left today", a past day came in "under target", a future
 *  day has kcal "to plan". Past the target it is a neutral "over" — never
 *  a warning. A day with nothing logged shows its target; with no target
 *  yet, what was eaten. `figure` is null when the words say it all. */
export type GaugeCenter = { figure: number | null; label: string };

const LEFT_LABEL: Record<RelativeDay, string> = {
  today: "kcal left today",
  past: "kcal under target",
  future: "kcal to plan",
};

export function gaugeCenter(
  eaten: number,
  target: number,
  when: RelativeDay,
): GaugeCenter {
  const e = Number.isFinite(eaten) && eaten > 0 ? Math.round(eaten) : 0;
  const t = Number.isFinite(target) && target > 0 ? Math.round(target) : 0;
  if (t === 0) return { figure: e, label: "kcal eaten" };
  if (e === 0) return { figure: t, label: "kcal target" };
  const remaining = t - e;
  if (remaining > 0) return { figure: remaining, label: LEFT_LABEL[when] };
  if (remaining === 0) return { figure: null, label: "Daily target reached" };
  return { figure: -remaining, label: "kcal over" };
}
