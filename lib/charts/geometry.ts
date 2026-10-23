/** Pure chart geometry for the hand-rolled SVG charts
 *  (components/shell/MiniLineChart.tsx): axis ticks, path builders and bar
 *  layout. No DOM, no React - everything here is a function of numbers in
 *  and numbers / strings out, so it is unit-tested directly. */

export const DAY_MS = 86_400_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar-day index (days since 1970-01-01) of a `YYYY-MM-DD` key.
 *
 *  Computed in UTC on purpose: the result names a calendar day, not an
 *  instant, so it is identical in every timezone and round-trips through
 *  `formatDayIndex`. (Flooring a *local* midnight's epoch ms - the old
 *  per-caller helper - gave the previous day east of UTC.) Date keys are
 *  validated at every write/import boundary, so a malformed one is a bug
 *  and throws rather than plotting at NaN. */
export function dayIndexFromIsoDate(date: string): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date key: "${date}"`);
  const [, y, mo, d] = m;
  return Math.round(Date.UTC(Number(y), Number(mo) - 1, Number(d)) / DAY_MS);
}

/** The `Date` (UTC midnight) a calendar-day index names. Format it with
 *  `timeZone: "UTC"` to read the calendar day back. */
export function dateFromDayIndex(day: number): Date {
  return new Date(day * DAY_MS);
}

// ---------------------------------------------------------------------------
// Y axis: "nice" ticks
// ---------------------------------------------------------------------------

export type NiceScale = {
  /** Domain lower bound - the first tick. */
  min: number;
  /** Domain upper bound - the last tick. */
  max: number;
  step: number;
  ticks: number[];
  /** Fraction digits that print every tick exactly (0 for 250, 1 for 2.5). */
  decimals: number;
};

const NICE_MULTIPLIERS = [1, 2, 2.5, 5, 10] as const;

/** Smallest 1 / 2 / 2.5 / 5 x 10^n step that is >= `raw`. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  // Tolerance so a raw step of exactly 2.5 x 10^n (float noise and all)
  // keeps 2.5 rather than jumping to 5.
  const multiplier = NICE_MULTIPLIERS.find((m) => m >= residual - 1e-9) ?? 10;
  return multiplier * magnitude;
}

/** Fraction digits needed to print multiples of `step` exactly. */
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 10; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 10;
}

/** Axis ticks on round values (1/2/2.5/5 x 10^n) covering `[lo, hi]` with
 *  at most `maxIntervals` gaps. The returned domain is widened outward to
 *  the enclosing ticks, so the data never sits outside the gridlines.
 *  A zero-width range (one value) is widened by one step each side. */
export function niceTicks(
  lo: number,
  hi: number,
  maxIntervals: number,
): NiceScale {
  const intervals = Math.max(1, Math.floor(maxIntervals));
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  if (a === b) {
    const pad = a === 0 ? 1 : niceStep(Math.abs(a) / 10);
    a -= pad;
    b += pad;
  }
  let step = niceStep((b - a) / intervals);
  let min = Math.floor(a / step + 1e-9) * step;
  let max = Math.ceil(b / step - 1e-9) * step;
  // Flooring/ceiling can add an interval; step up until it fits.
  while (Math.round((max - min) / step) > intervals) {
    step = niceStep(step * 1.0001);
    min = Math.floor(a / step + 1e-9) * step;
    max = Math.ceil(b / step - 1e-9) * step;
  }
  const decimals = stepDecimals(step);
  const count = Math.round((max - min) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) =>
    Number((min + i * step).toFixed(decimals)),
  );
  return {
    min: Number(min.toFixed(decimals)),
    max: Number(max.toFixed(decimals)),
    step,
    ticks,
    decimals,
  };
}

// ---------------------------------------------------------------------------
// X axis: calendar-day ticks
// ---------------------------------------------------------------------------

export type DayTick = { day: number; label: string };

/** Day-of-week offset so `(day + MONDAY_OFFSET) % 7 === 0` on Mondays
 *  (1970-01-01, day 0, was a Thursday). */
const MONDAY_OFFSET = 3;

type DayStep =
  | { kind: "day"; n: number }
  | { kind: "week"; n: number }
  | { kind: "month"; n: number };

const DAY_STEPS: readonly DayStep[] = [
  { kind: "day", n: 1 },
  { kind: "day", n: 2 },
  { kind: "day", n: 3 },
  { kind: "week", n: 1 },
  { kind: "week", n: 2 },
  { kind: "month", n: 1 },
  { kind: "month", n: 2 },
  { kind: "month", n: 3 },
  { kind: "month", n: 6 },
  { kind: "month", n: 12 },
];

function daysFor(step: DayStep, first: number, last: number): number[] {
  const out: number[] = [];
  if (step.kind === "day") {
    for (let d = first; d <= last; d += step.n) out.push(d);
  } else if (step.kind === "week") {
    // Mondays, every n weeks, counted from the first Monday in range.
    const mod = (((first + MONDAY_OFFSET) % 7) + 7) % 7;
    const firstMonday = mod === 0 ? first : first + (7 - mod);
    for (let d = firstMonday; d <= last; d += 7 * step.n) out.push(d);
  } else {
    // 1st of the month, on months divisible by n (Jan/Apr/Jul/Oct for n=3).
    const start = dateFromDayIndex(first);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    for (;;) {
      const d = Math.round(Date.UTC(y, m, 1) / DAY_MS);
      if (d > last) break;
      if (d >= first && m % step.n === 0) out.push(d);
      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
  }
  return out;
}

/** Evenly spaced calendar ticks across `[first, last]` (day indices):
 *  every 1/2/3 days, Mondays (weekly / fortnightly), or month starts -
 *  whichever is the finest step whose ticks `fits` accepts. Labels are
 *  locale-formatted ("Oct 23", or "Oct" for month steps, with the year on
 *  January ticks when the range spans more than one year). When that
 *  leaves two labels or fewer, the first and last days are labelled
 *  instead, evenly filled in between as far as they fit.
 *
 *  Whether labels fit is the caller's call, because only it knows where
 *  each one lands: neither a count nor a spacing in days can see that an
 *  edge label pulled inside the plot (so it doesn't clip) now crowds its
 *  neighbour. A step `fits` rejects is never drawn with a label dropped,
 *  so the labels shown always keep one even step. */
export function dayTicks(
  first: number,
  last: number,
  fits: (ticks: readonly DayTick[]) => boolean,
  locale?: string,
): DayTick[] {
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  const dayFmt = dayFormat(locale);
  // Month steps label "Oct", and across a year boundary the January tick
  // names the new year instead ("Nov, Dec, 2026, Feb"). A two-digit year
  // ("Oct 25") would read exactly like the day labels used everywhere
  // else - the 25th of October - so it is never used.
  const multiYear =
    dateFromDayIndex(lo).getUTCFullYear() !==
    dateFromDayIndex(hi).getUTCFullYear();
  const monthFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  const yearFmt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    timeZone: "UTC",
  });
  const dayTick = (day: number): DayTick => ({
    day,
    label: dayFmt.format(dateFromDayIndex(day)),
  });
  // Nothing fits (not even one tick of the coarsest step): label the first
  // day alone.
  let calendar: DayTick[] = [dayTick(lo)];
  for (const step of DAY_STEPS) {
    const days = daysFor(step, lo, hi);
    if (days.length === 0) continue;
    const ticks = days.map((day) => {
      const date = dateFromDayIndex(day);
      const fmt =
        step.kind !== "month"
          ? dayFmt
          : multiYear && date.getUTCMonth() === 0
            ? yearFmt
            : monthFmt;
      return { day, label: fmt.format(date) };
    });
    if (fits(ticks)) {
      calendar = ticks;
      break;
    }
  }
  // A narrow axis fits only one or two calendar ticks, often at neither end
  // ("Oct 5" alone over Oct 1-10). There, label the first and last days
  // instead, with as many days between them as fit, on a step that divides
  // the span so it lands on both ends. Only within a year, where a day
  // label ("Oct 23") can't name two different days.
  const span = hi - lo;
  if (calendar.length > 2 || span <= 0 || span >= 365) return calendar;
  for (let n = 1; n <= span; n++) {
    if (span % n !== 0) continue;
    const ticks: DayTick[] = [];
    for (let d = lo; d <= hi; d += n) ticks.push(dayTick(d));
    if (fits(ticks)) return ticks;
  }
  return calendar;
}

function dayFormat(locale?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Oct 23" for a day index, in the given (or runtime) locale. */
export function formatDayIndex(day: number, locale?: string): string {
  return dayFormat(locale).format(dateFromDayIndex(day));
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export type Pt = { x: number; y: number };

const f = (n: number) => Number(n.toFixed(2));

/** Straight segments through every point. */
export function linearPath(pts: readonly Pt[]): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x)},${f(p.y)}`)
    .join(" ");
}

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** Monotone cubic interpolation (Steffen 1990, the method behind d3's
 *  `curveMonotoneX`). Unlike Catmull-Rom it never overshoots: each
 *  segment's Bezier control points stay inside the y-range of its two end
 *  points, so the curve can't dip below the lowest day or bulge above the
 *  highest. Points must be sorted by x. */
export function monotonePath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n < 3) return linearPath(pts);
  const h: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    h.push(dx);
    s.push(dx === 0 ? 0 : (b.y - a.y) / dx);
  }
  // Interior tangents (Steffen): zero at local extrema, otherwise bounded
  // by the smaller neighbouring secant.
  const t: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const s0 = s[i - 1] ?? 0;
    const s1 = s[i] ?? 0;
    const h0 = h[i - 1] ?? 0;
    const h1 = h[i] ?? 0;
    const p = h0 + h1 === 0 ? 0 : (s0 * h1 + s1 * h0) / (h0 + h1);
    // (sign + sign) is 0 at an extremum (or a flat neighbour), else +-2,
    // so |t| <= 2 x the smaller secant: each control point then moves at
    // most 2/3 of its segment's rise, staying inside that segment's range.
    t[i] =
      (sign(s0) + sign(s1)) *
      Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  }
  // End tangents: one-sided, (3s - t_neighbour) / 2. With the neighbour in
  // [0, 2s] this lands in [0.5s, 1.5s] - a control offset of at most half
  // the segment's rise.
  t[0] = (3 * (s[0] ?? 0) - (t[1] ?? 0)) / 2;
  t[n - 1] = (3 * (s[n - 2] ?? 0) - (t[n - 2] ?? 0)) / 2;

  const first = pts[0];
  if (!first) return "";
  let d = `M${f(first.x)},${f(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const dx = (h[i] ?? 0) / 3;
    const c1y = a.y + dx * (t[i] ?? 0);
    const c2y = b.y - dx * (t[i + 1] ?? 0);
    d += ` C${f(a.x + dx)},${f(c1y)} ${f(b.x - dx)},${f(c2y)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** A step line through per-point levels: each point's level is held across
 *  its slot `[x - half, x + half]`, where a slot ends halfway to the
 *  neighbouring point (or at `bounds` for the outermost points), with
 *  vertical risers where the level changes. This is how a per-day target
 *  reads: flat for the day, stepping at the day boundary. Points must be
 *  sorted by x. */
export function stepPath(
  pts: readonly Pt[],
  bounds: { left: number; right: number },
): string {
  if (pts.length === 0) return "";
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const start = prev ? (prev.x + p.x) / 2 : bounds.left;
    const end = next ? (p.x + next.x) / 2 : bounds.right;
    d += i === 0 ? `M${f(start)},${f(p.y)}` : ` L${f(start)},${f(p.y)}`;
    d += ` L${f(end)},${f(p.y)}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export type BarInput = {
  x: number;
  value: number;
  /** That point's target, if any. */
  target?: number;
};

export type BarRect = {
  /** Index into the input. */
  index: number;
  /** Slot centre, px. */
  cx: number;
  /** Left edge, px. */
  left: number;
  width: number;
  /** Solid part: baseline up to min(value, target) - or the whole bar
   *  when there is no target. `top` < `bottom` in SVG space. */
  base: { top: number; bottom: number };
  /** The part past the target, drawn in the same hue at lower intensity
   *  (calm overshoot). Absent when the value is at or under target. */
  over?: { top: number; bottom: number; amount: number };
};

export type BarLayout = {
  /** One slot per x unit across the domain, so gaps (unlogged days) stay
   *  visible as empty slots. */
  slotWidth: number;
  /** Slot centre for an x value. */
  xToPx: (x: number) => number;
  bars: BarRect[];
};

/** Smallest positive gap between consecutive (sorted, distinct) x values -
 *  the series' natural unit (1 for day indices). */
export function xUnit(xs: readonly number[]): number {
  const sorted = [...new Set(xs)].sort((a, b) => a - b);
  let unit = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a === undefined || b === undefined) continue;
    unit = Math.min(unit, b - a);
  }
  return Number.isFinite(unit) && unit > 0 ? unit : 1;
}

/** Lay out one bar per point in `[left, left + width]`, from a baseline at
 *  `yToPx(0)` (clamped into the plot). Bars are 60% of their slot, capped
 *  at `maxBarWidth` and never thinner than 1px.
 *
 *  `unit` is the x distance one slot covers. Pass it when the axis has a
 *  natural unit (1 for day indices); left out, it is inferred from the
 *  smallest gap in the data, which can't tell "logged every other day"
 *  from "a series in steps of two". */
export function layoutBars(
  data: readonly BarInput[],
  opts: {
    left: number;
    width: number;
    yToPx: (y: number) => number;
    baselinePx: number;
    maxBarWidth?: number;
    unit?: number;
  },
): BarLayout {
  const xs = data.map((d) => d.x);
  const unit = opts.unit !== undefined && opts.unit > 0 ? opts.unit : xUnit(xs);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const slots = data.length === 0 ? 1 : Math.round((xMax - xMin) / unit) + 1;
  const slotWidth = opts.width / slots;
  const barWidth = Math.max(
    1,
    Math.min(opts.maxBarWidth ?? 24, slotWidth * 0.6),
  );
  const xToPx = (x: number) =>
    opts.left + ((x - xMin) / unit + 0.5) * slotWidth;
  const baseline = opts.baselinePx;
  const bars = data.map<BarRect>((d, index) => {
    const cx = xToPx(d.x);
    const valuePx = opts.yToPx(d.value);
    const hasOver = d.target !== undefined && d.value > d.target;
    const capPx =
      hasOver && d.target !== undefined ? opts.yToPx(d.target) : valuePx;
    const rect: BarRect = {
      index,
      cx,
      left: cx - barWidth / 2,
      width: barWidth,
      base: {
        top: Math.min(capPx, baseline),
        bottom: Math.max(capPx, baseline),
      },
    };
    if (hasOver && d.target !== undefined) {
      rect.over = {
        top: Math.min(valuePx, capPx),
        bottom: Math.max(valuePx, capPx),
        amount: d.value - d.target,
      };
    }
    return rect;
  });
  return { slotWidth, xToPx, bars };
}
