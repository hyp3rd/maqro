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

/** How far past the index an overshoot is drawn at most, in laps. Past
 *  the target the solid arc covers the rest of the lap (see `ringStrokes`),
 *  so a longer overshoot would shrink it: at 2× a full pale lap with no
 *  solid arc left reads as an empty ring — "little eaten". Capped here,
 *  the solid arc always holds two thirds of the lap; the gauge's centre
 *  states the overshoot in kcal. */
export const MAX_OVER_LAP = 1 / 3;

/** Stroke lengths of one ring for `value` against `target`.
 *  `fill` runs from the index up to the target (at most one lap); `over`
 *  is how far an overshoot continues past the index, drawn in the same hue
 *  at lower intensity, to scale up to `MAX_OVER_LAP`. Over and under are
 *  shown, never clamped away and never judged. No positive target (or no
 *  intake) → nothing drawn. */
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
    over: Math.min(Math.max(ratio - 1, 0), MAX_OVER_LAP) * c,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `stroke-dasharray` drawing the first `length` of a ring and leaving the
 *  rest of the lap empty. */
export function dashArray(length: number, ringCircumference: number): string {
  return `${round3(length)} ${round3(ringCircumference)}`;
}

/** How a ring is stroked: the solid arc, and the overshoot at lower
 *  intensity. Under target the solid arc runs from 12 o'clock to the
 *  intake. Over it the lap is complete: the overshoot is drawn from 12
 *  o'clock on (the arc visibly carries on past the index) and the solid arc
 *  covers the rest of the lap up to the index, so the two never stack. */
export type RingStrokes = {
  solid: { dashArray: string; dashOffset: number };
  over: { dashArray: string; dashOffset: number } | null;
};

export function ringStrokes(arc: RingArc): RingStrokes {
  const c = arc.circumference;
  if (arc.over <= 0) {
    return {
      solid: { dashArray: dashArray(arc.fill, c), dashOffset: 0 },
      over: null,
    };
  }
  return {
    solid: {
      dashArray: dashArray(arc.fill - arc.over, c),
      // A negative offset starts the dash `over` along the ring.
      dashOffset: -round3(arc.over),
    },
    over: { dashArray: dashArray(arc.over, c), dashOffset: 0 },
  };
}

/** The dash and gap (viewBox units) of a ring's planned stretch. */
export const PLANNED_DASH = 3;
export const PLANNED_GAP = 2.5;

/** How a ring draws today's planned food: from the end of the eaten arc on
 *  to where eaten + planned reaches, in short dashes so it reads as not yet
 *  eaten. It stops at the target index — past it the eaten arc already
 *  shows an overshoot, and the readout says where the plan lands. One
 *  `stroke-dasharray` (no offset): an empty run to the eaten arc's end,
 *  the dashes, then the rest of the lap empty, its total longer than the
 *  lap so the pattern never repeats. `null` when there is nothing to draw:
 *  no plan, no target, or the eaten arc already at the index. */
export function plannedStroke(
  eaten: number,
  planned: number,
  target: number,
  radius: number,
): { dashArray: string } | null {
  if (!(Number.isFinite(target) && target > 0)) return null;
  if (!(Number.isFinite(planned) && planned > 0)) return null;
  const c = circumference(radius);
  const e = Number.isFinite(eaten) && eaten > 0 ? eaten : 0;
  const start = Math.min(e / target, 1) * c;
  const length = Math.min((e + planned) / target, 1) * c - start;
  if (length <= 0) return null;
  const parts = [0, start];
  for (let drawn = 0; drawn < length;) {
    const dash = Math.min(PLANNED_DASH, length - drawn);
    drawn += dash;
    const gap = Math.min(PLANNED_GAP, length - drawn);
    drawn += gap;
    parts.push(dash, gap);
  }
  parts.push(0, c);
  return { dashArray: parts.map(round3).join(" ") };
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
