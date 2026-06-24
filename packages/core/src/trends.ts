import { addDays } from "./date";
import type { WeightEntry } from "./records";
import { KCAL_PER_KG } from "./types";

/** Smoothed weight series — pairs each entry with the trailing-
 *  window mean. The smoothed line is what the trends UI plots
 *  alongside the raw weigh-ins; the daily noise obscures the
 *  signal, and the moving average is the simplest filter that
 *  matches what serious trackers (Hacker's Diet, Libra, Happy
 *  Scale) all settle on. */
export type SmoothedPoint = {
  date: string;
  kg: number;
  /** Trailing N-day mean ending at this point. NULL on the first
   *  (N-1) points where the window doesn't have enough data — the
   *  UI renders these as gaps on the smoothed line. */
  smoothed: number | null;
};

/** Default smoothing window. 7 days is the de-facto standard —
 *  long enough to flatten daily glycogen/sodium swings, short
 *  enough to react within a week to a real trend shift. */
export const DEFAULT_SMOOTHING_WINDOW = 7;

/** Compute a trailing simple moving average over a chronological
 *  weight series. `weights` is assumed to be sorted by date asc;
 *  if not, the caller should sort first — the helper trusts the
 *  input order to avoid an O(n log n) sort on every recompute.
 *
 *  Daily sparseness handling: we DON'T forward-fill missing days.
 *  If the user weighs in three times a week, the window walks
 *  three points at a time, not 7. That keeps the math honest —
 *  filling gaps with the last value would bias the trend toward
 *  whatever the user's last weigh-in was. */
export function smoothWeights(
  weights: WeightEntry[],
  window: number = DEFAULT_SMOOTHING_WINDOW,
): SmoothedPoint[] {
  if (window < 1) throw new Error("Smoothing window must be ≥ 1");
  return weights.map((w, i) => {
    const start = Math.max(0, i - window + 1);
    // The "have enough data" check is whether the window can fit a
    // full N points behind the current index. Earlier points get
    // null so the UI doesn't draw a misleading half-window line.
    const haveEnough = i + 1 >= window;
    if (!haveEnough) return { date: w.date, kg: w.kg, smoothed: null };
    const slice = weights.slice(start, i + 1);
    const sum = slice.reduce((acc, e) => acc + e.kg, 0);
    return { date: w.date, kg: w.kg, smoothed: sum / slice.length };
  });
}

export type PlateauState = {
  /** True when the smoothed series has changed by less than
   *  `toleranceKg` across the last `windowDays` of weigh-ins. */
  plateaued: boolean;
  /** How many days the user has been within the tolerance band.
   *  Always present even when plateaued=false (a "flat for 4 days"
   *  reading is interesting context even if it's not a plateau by
   *  the 14-day threshold). */
  daysFlat: number;
  /** Smoothed weight at the start vs end of the analyzed window.
   *  NULL when there isn't enough data to make a call. */
  startKg: number | null;
  endKg: number | null;
  /** How many smoothed weigh-ins fed the flat-band call. Low counts mean the
   *  read is tentative — the UI can say "log a few more to confirm". */
  weighIns: number;
  /** Human-readable advisory the UI can render as-is, or null if
   *  there's nothing useful to say (insufficient data, or movement
   *  is healthy). */
  advisory: string | null;
};

/** Default thresholds for plateau detection. A "plateau" is
 *  14 consecutive days where the smoothed weight moves less than
 *  0.5 kg. These numbers are a sensible default for a body-weight
 *  signal — short enough that a real plateau is caught within
 *  two weeks, generous enough that ordinary day-to-day variance
 *  doesn't false-positive. */
export const DEFAULT_PLATEAU_WINDOW_DAYS = 14;
export const DEFAULT_PLATEAU_TOLERANCE_KG = 0.5;

function dayDiff(aDate: string, bDate: string): number {
  const [ay, am, ad] = aDate.split("-").map(Number);
  const [by, bm, bd] = bDate.split("-").map(Number);
  const a = new Date(ay, am - 1, ad).getTime();
  const b = new Date(by, bm - 1, bd).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Detect whether the user has plateaued in the last `windowDays`.
 *  Uses the SMOOTHED series so noisy daily readings don't
 *  false-positive — the same `smoothWeights` output the chart
 *  draws. If fewer than two smoothed points exist within the
 *  window, returns `plateaued: false` with no advisory (can't
 *  call it with one number). */
export function detectPlateau(
  weights: WeightEntry[],
  goal: "lose" | "maintain" | "gain",
  windowDays: number = DEFAULT_PLATEAU_WINDOW_DAYS,
  toleranceKg: number = DEFAULT_PLATEAU_TOLERANCE_KG,
): PlateauState {
  if (weights.length === 0) {
    return {
      plateaued: false,
      daysFlat: 0,
      startKg: null,
      endKg: null,
      weighIns: 0,
      advisory: null,
    };
  }
  const smoothed = smoothWeights(weights).filter(
    (p): p is SmoothedPoint & { smoothed: number } => p.smoothed !== null,
  );
  if (smoothed.length < 2) {
    return {
      plateaued: false,
      daysFlat: 0,
      startKg: null,
      endKg: null,
      weighIns: 0,
      advisory: null,
    };
  }
  const last = smoothed[smoothed.length - 1];
  // Walk backward until we find a point outside the tolerance OR
  // we run out of points. `daysFlat` is the gap to the earliest
  // in-tolerance point.
  let earliest = last;
  let earliestIdx = smoothed.length - 1;
  for (let i = smoothed.length - 2; i >= 0; i--) {
    const p = smoothed[i];
    if (Math.abs(p.smoothed - last.smoothed) > toleranceKg) break;
    earliest = p;
    earliestIdx = i;
  }
  const daysFlat = dayDiff(earliest.date, last.date);
  const plateaued = daysFlat >= windowDays;
  // Smoothed weigh-ins inside the flat band (earliest…last inclusive).
  const weighIns = smoothed.length - earliestIdx;

  let advisory: string | null = null;
  if (plateaued) {
    const basis = `across ${weighIns} weigh-in${weighIns === 1 ? "" : "s"} over ${daysFlat} days`;
    // Few weigh-ins ⇒ the call is tentative; explain why a single new entry
    // won't have cleared it (the trend is smoothed over weeks).
    const moreData =
      weighIns < 4
        ? " Log a few more weigh-ins to be sure — a single reading won't shift a multi-week trend."
        : "";
    if (goal === "lose") {
      advisory = `Weight has been flat (±${toleranceKg} kg) ${basis} while you're aiming to lose. Likely causes: TDEE estimate too high (recalibrate below), unlogged calories, or water retention from a new training stimulus. Tighten logging accuracy for 1–2 weeks before lowering calories.${moreData}`;
    } else if (goal === "gain") {
      advisory = `Weight has been flat (±${toleranceKg} kg) ${basis} while you're aiming to gain. Either your TDEE is underestimated and you're maintaining, or the surplus isn't landing on the plate. Add 100–150 kcal/day and give it another 2 weeks.${moreData}`;
    } else {
      // Maintaining: a flat trend is the goal — frame it as success, not alarm.
      advisory = `Weight has been stable (±${toleranceKg} kg) ${basis} — that's exactly the goal while maintaining. Carry on.`;
    }
  }
  return {
    plateaued,
    daysFlat,
    startKg: earliest.smoothed,
    endKg: last.smoothed,
    weighIns,
    advisory,
  };
}

export type TdeeRecalibration = {
  /** Calorie-per-day adjustment vs. the formula's TDEE estimate.
   *  Positive means the formula UNDER-estimated and the user's
   *  real TDEE is higher; negative means the formula over-
   *  estimated. */
  deltaKcalPerDay: number;
  /** Suggested new TDEE — formula TDEE + deltaKcalPerDay,
   *  rounded to nearest 10 kcal. */
  suggestedTdee: number;
  /** Number of full days of data used. The recalibration is more
   *  reliable when this is ≥ 14. */
  windowDays: number;
  /** Net weight change in kg across the window (latest smoothed −
   *  earliest smoothed). Sign convention: positive = gained. */
  weightChangeKg: number;
  /** Human-readable nudge or null when there isn't enough data /
   *  the suggestion is within noise. */
  advisory: string | null;
};

/** Recalibrate TDEE from observed weight change vs. the daily
 *  calorie delta the user has been aiming for.
 *
 *  Math:
 *    expected weight change (kg) = (calorie delta × days) ÷ 7700
 *    actual weight change (kg)   = smoothed[end] − smoothed[start]
 *    error (kg)                  = expected − actual
 *    daily TDEE error (kcal/day) = (error × 7700) ÷ days
 *
 *  If the user has been eating 500 kcal under their formula TDEE
 *  for 14 days, they "should" have lost ~0.91 kg. If they
 *  actually lost 0.40 kg, they're missing ~280 kcal/day — TDEE is
 *  ~280 kcal lower than the formula said.
 *
 *  Returns `{ advisory: null }` when:
 *    - Fewer than 14 days of smoothed data (too noisy to call)
 *    - Suggested change is within ±50 kcal/day (within model noise)
 *    - User is on "maintain" goal with no intentional delta */
export function recalibrateTdee(opts: {
  weights: WeightEntry[];
  formulaTdee: number;
  /** Intended daily calorie delta vs. TDEE — negative for cuts,
   *  positive for bulks. Read from `calculatedValues.dailyDelta`. */
  dailyDelta: number;
  minWindowDays?: number;
  noiseFloorKcal?: number;
}): TdeeRecalibration {
  const minDays = opts.minWindowDays ?? 14;
  const noiseFloor = opts.noiseFloorKcal ?? 50;
  const smoothed = smoothWeights(opts.weights).filter(
    (p): p is SmoothedPoint & { smoothed: number } => p.smoothed !== null,
  );
  if (smoothed.length < 2) {
    return {
      deltaKcalPerDay: 0,
      suggestedTdee: opts.formulaTdee,
      windowDays: 0,
      weightChangeKg: 0,
      advisory: null,
    };
  }
  const start = smoothed[0];
  const end = smoothed[smoothed.length - 1];
  const days = dayDiff(start.date, end.date);
  if (days < minDays) {
    return {
      deltaKcalPerDay: 0,
      suggestedTdee: opts.formulaTdee,
      windowDays: days,
      weightChangeKg: end.smoothed - start.smoothed,
      advisory: null,
    };
  }
  const actualChange = end.smoothed - start.smoothed; // kg, signed
  const expectedChange = (opts.dailyDelta * days) / KCAL_PER_KG; // kg, signed
  const errorKg = expectedChange - actualChange;
  const errorKcalPerDay = (errorKg * KCAL_PER_KG) / days;
  // Round to nearest 10 kcal so the suggestion reads cleanly and
  // doesn't pretend to single-kcal precision the underlying signal
  // doesn't have.
  const deltaKcalPerDay = Math.round(errorKcalPerDay / 10) * 10;
  const suggestedTdee =
    Math.round((opts.formulaTdee + deltaKcalPerDay) / 10) * 10;

  let advisory: string | null = null;
  if (Math.abs(deltaKcalPerDay) >= noiseFloor) {
    const direction = deltaKcalPerDay > 0 ? "higher" : "lower";
    const absDelta = Math.abs(deltaKcalPerDay);
    advisory = `Based on ${days} days of weigh-ins, your real TDEE looks about ${absDelta} kcal/day ${direction} than the formula estimate — try ${suggestedTdee} kcal/day for your maintenance and recalculate targets from there. Formula-based estimates miss by 10–20% for many people; this is the calibration that closes the gap.`;
  }
  return {
    deltaKcalPerDay,
    suggestedTdee,
    windowDays: days,
    weightChangeKg: actualChange,
    advisory,
  };
}

export type AdaptiveTdeeConfidence = "none" | "low" | "medium" | "high";

export type AdaptiveTdee = {
  /** Maintenance calories inferred from logged intake minus the energy
   *  represented by the weight trend, over the window. NULL when there
   *  isn't enough data to make an honest call. */
  observedTdee: number | null;
  /** Days actually spanned by the weigh-in window used (end − start). */
  windowDays: number;
  /** Logged-intake days that fell inside that window. */
  loggedDays: number;
  /** Mean logged intake (kcal/day) across the window, or null. */
  meanIntake: number | null;
  /** Smoothed weight-trend slope across the window, in kg/week
   *  (positive = gaining), or null. */
  weightSlopeKgPerWeek: number | null;
  /** How much to trust `observedTdee`, from data density + span. */
  confidence: AdaptiveTdeeConfidence;
  /** One-line summary the UI can render as-is, or null. */
  advisory: string | null;
};

/** Human-readable confidence label, shared across surfaces. Empty string
 *  for "none" so callers can `&&` it away. */
export function confidenceLabel(c: AdaptiveTdeeConfidence): string {
  switch (c) {
    case "high":
      return "high confidence";
    case "medium":
      return "medium confidence";
    case "low":
      return "low confidence";
    default:
      return "";
  }
}

/** Look-back window and the minimum data needed before we'll commit to
 *  an estimate. 28 days balances responsiveness against weight noise;
 *  the floors keep us quiet until the signal is real. */
const ADAPTIVE_WINDOW_DAYS = 28;
const ADAPTIVE_MIN_WINDOW_DAYS = 14;
const ADAPTIVE_MIN_LOGGED_DAYS = 10;
/** Clamp to the same range the manual-TDEE input accepts (PersonalInfoForm). */
const ADAPTIVE_TDEE_BOUNDS: readonly [number, number] = [800, 6000];

/** Only surface the adaptive-TDEE suggestion when it differs from the
 *  current target basis by at least this much — below it the user is
 *  already calibrated and a card would just be noise. Shared by every
 *  surface (Progress view + print report) so they agree on when to show
 *  it. Mirrors the ±50 kcal noise floor `recalibrateTdee` uses. */
export const ADAPTIVE_DELTA_THRESHOLD = 50;

/** Least-squares slope (Δy per unit x) of paired points. Returns 0 when
 *  x has no spread — callers here always pass ≥ 2 points across ≥ 14 days,
 *  so the denominator is non-zero in practice. */
function leastSquaresSlope(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/** Infer maintenance calories ("adaptive TDEE") from what the user
 *  ACTUALLY logged against how their weight actually moved — the
 *  energy-balance identity, not the formula's activity guess:
 *
 *    TDEE ≈ mean daily intake − (weight-trend slope × 7700 kcal/kg)
 *
 *  Why this beats `recalibrateTdee`: that one assumes the user ate
 *  exactly to target and back-solves the formula error. This reads real
 *  intake from the logs, so it doesn't care whether the user hit their
 *  target — only that they logged. It's also robust to a CONSISTENT
 *  logging bias: under-count by 10% every day and the inferred
 *  maintenance is in your own logged units, so a target set from it
 *  still produces the intended weight trend. (The failure mode is
 *  INconsistent logging — hence the coverage gate.)
 *
 *  The weight slope is a least-squares fit over the smoothed series (the
 *  same line the chart draws), which is steadier than an endpoint
 *  difference on a noisy signal.
 *
 *  Returns `observedTdee: null` (confidence "none") until there are
 *  enough weigh-ins spanning enough days AND enough logged days in the
 *  window to be honest about it. */
export function inferAdaptiveTdee(opts: {
  weights: WeightEntry[];
  /** Per-day logged intake — only days the user actually logged
   *  (calories > 0). Date strings YYYY-MM-DD; order irrelevant. */
  intake: { date: string; calories: number }[];
  windowDays?: number;
  minWindowDays?: number;
  minLoggedDays?: number;
}): AdaptiveTdee {
  const windowDays = opts.windowDays ?? ADAPTIVE_WINDOW_DAYS;
  const minWindowDays = opts.minWindowDays ?? ADAPTIVE_MIN_WINDOW_DAYS;
  const minLoggedDays = opts.minLoggedDays ?? ADAPTIVE_MIN_LOGGED_DAYS;
  const none: AdaptiveTdee = {
    observedTdee: null,
    windowDays: 0,
    loggedDays: 0,
    meanIntake: null,
    weightSlopeKgPerWeek: null,
    confidence: "none",
    advisory: null,
  };

  const smoothed = smoothWeights(opts.weights).filter(
    (p): p is SmoothedPoint & { smoothed: number } => p.smoothed !== null,
  );
  if (smoothed.length < 2) return none;

  // Window = the smoothed points within `windowDays` of the latest one.
  const lastDate = smoothed[smoothed.length - 1].date;
  const inWindow = smoothed.filter(
    (p) => dayDiff(p.date, lastDate) <= windowDays,
  );
  if (inWindow.length < 2) return none;
  const start = inWindow[0];
  const end = inWindow[inWindow.length - 1];
  const days = dayDiff(start.date, end.date);
  if (days < minWindowDays) return { ...none, windowDays: days };

  // Weight trend (kg/day) over the smoothed window, then kg/week for UI.
  const slopeKgPerDay = leastSquaresSlope(
    inWindow.map((p) => ({ x: dayDiff(start.date, p.date), y: p.smoothed })),
  );
  const weightSlopeKgPerWeek = slopeKgPerDay * 7;

  // Mean logged intake over the SAME interval — the energy-balance
  // identity needs intake and weight change measured across one span.
  const windowIntake = opts.intake.filter((d) => {
    const off = dayDiff(start.date, d.date);
    return off >= 0 && off <= days && d.calories > 0;
  });
  const loggedDays = windowIntake.length;
  if (loggedDays < minLoggedDays) {
    return { ...none, windowDays: days, loggedDays, weightSlopeKgPerWeek };
  }
  const meanIntake =
    windowIntake.reduce((s, d) => s + d.calories, 0) / loggedDays;

  const rawTdee = meanIntake - slopeKgPerDay * KCAL_PER_KG;
  const [lo, hi] = ADAPTIVE_TDEE_BOUNDS;
  const observedTdee = Math.min(
    hi,
    Math.max(lo, Math.round(rawTdee / 10) * 10),
  );

  // Confidence from how densely the window is actually covered by data.
  const coverage = loggedDays / (days + 1);
  const weighIns = inWindow.length;
  let confidence: AdaptiveTdeeConfidence = "low";
  if (days >= 21 && coverage >= 0.7 && weighIns >= 8) confidence = "high";
  else if (days >= 14 && coverage >= 0.5 && weighIns >= 4)
    confidence = "medium";

  const advisory = `Over the last ${days} days (${loggedDays} logged), your intake and weight trend put maintenance near ${observedTdee} kcal/day.`;

  return {
    observedTdee,
    windowDays: days,
    loggedDays,
    meanIntake: Math.round(meanIntake),
    weightSlopeKgPerWeek,
    confidence,
    advisory,
  };
}

/** One point on the observed-maintenance time series. */
export type TdeePoint = {
  /** As-of date (`YYYY-MM-DD`) the estimate was computed for. */
  date: string;
  observedTdee: number;
  confidence: AdaptiveTdeeConfidence;
};

/** Default reach + spacing of the TDEE-over-time series. Weekly points over
 *  ~6 months is enough to read a trend without re-running the estimate for
 *  every day. */
const TDEE_HISTORY_SPAN_DAYS = 180;
const TDEE_HISTORY_STEP_DAYS = 7;

/** The adaptive-TDEE estimate as a time series — `inferAdaptiveTdee` re-run
 *  "as of" each weekly point over the trailing `spanDays`, using only the data
 *  available up to that date. Shows how observed maintenance has moved as the
 *  body adapts, WITHOUT persisting anything: it's derived on the fly from the
 *  same weights + intake the rest of Trends already holds, so there's no store,
 *  migration, or Pro-downgrade cleanup. Points with too little data
 *  (`observedTdee` null) are omitted, so an early series may be short. */
export function computeTdeeHistory(opts: {
  weights: WeightEntry[];
  intake: { date: string; calories: number }[];
  spanDays?: number;
  stepDays?: number;
  windowDays?: number;
}): TdeePoint[] {
  const spanDays = opts.spanDays ?? TDEE_HISTORY_SPAN_DAYS;
  const stepDays = opts.stepDays ?? TDEE_HISTORY_STEP_DAYS;
  if (stepDays < 1) throw new Error("TDEE-history step must be ≥ 1 day");
  if (opts.weights.length === 0) return [];

  // `inferAdaptiveTdee` → `smoothWeights` trusts ascending date order; sort once.
  const sorted = [...opts.weights].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;

  const points: TdeePoint[] = [];
  // As-of dates from (last − span) forward to last, oldest first. Anchor the
  // first offset on a step multiple so `back === 0` (the latest, most relevant
  // point) is always included even when span isn't a multiple of step. Round
  // UP so the oldest offset still covers the full requested span (a `floor`
  // would stop short by up to `stepDays − 1`); an offset that predates the
  // first weigh-in is skipped below, so over-reaching is harmless.
  const firstBack = Math.ceil(spanDays / stepDays) * stepDays;
  for (let back = firstBack; back >= 0; back -= stepDays) {
    const asOf = addDays(lastDate, -back);
    if (asOf < firstDate) continue; // no weigh-ins yet at this as-of date
    const est = inferAdaptiveTdee({
      weights: sorted.filter((w) => w.date <= asOf),
      intake: opts.intake.filter((d) => d.date <= asOf),
      windowDays: opts.windowDays,
    });
    if (est.observedTdee !== null) {
      points.push({
        date: asOf,
        observedTdee: est.observedTdee,
        confidence: est.confidence,
      });
    }
  }
  return points;
}

/** What a weekly auto-adapt run should do with a fresh maintenance estimate. */
export type AutoAdaptAction = "apply" | "hold" | "skip";

export type AutoAdaptDecision = {
  action: AutoAdaptAction;
  /** The TDEE to apply (action "apply") or suggest (action "hold"); null on
   *  "skip". */
  newTdee: number | null;
  /** Signed change vs. the current basis (`newTdee − currentTdee`); 0 on skip. */
  deltaKcal: number;
  /** Short human reason — for the change log + the user notification. */
  reason: string;
};

/** How big a weekly auto-adapt step may be applied automatically. A change
 *  within this cap is a safe nudge and lands hands-off; anything larger is held
 *  for a one-tap confirm so a big swing never moves the target silently. */
export const AUTO_ADAPT_STEP_CAP = 75;

/** Decide what a weekly **auto-adapt** run does, given the freshly observed
 *  maintenance and the TDEE the targets currently use. The hybrid policy
 *  (opt-in, Pro):
 *   - **skip** — confidence below "medium", or the change is within the noise
 *     floor (already calibrated). No change, no nudge.
 *   - **apply** — `|delta| ≤ stepCap`: a small, safe weekly nudge, applied
 *     automatically. The new value is the observed maintenance (itself already
 *     within the cap of the current basis).
 *   - **hold** — `|delta| > stepCap`: too large to move silently; surface the
 *     observed maintenance for a one-tap confirm instead.
 *  Pure + deterministic so the cron and its tests share one policy. Never acts
 *  on a "none"/"low" estimate. */
export function decideAutoAdapt(opts: {
  observed: AdaptiveTdee;
  currentTdee: number;
  stepCap?: number;
  noiseFloor?: number;
}): AutoAdaptDecision {
  const stepCap = opts.stepCap ?? AUTO_ADAPT_STEP_CAP;
  const noiseFloor = opts.noiseFloor ?? ADAPTIVE_DELTA_THRESHOLD;
  const { observedTdee, confidence } = opts.observed;
  const skip = (reason: string): AutoAdaptDecision => ({
    action: "skip",
    newTdee: null,
    deltaKcal: 0,
    reason,
  });

  if (observedTdee === null) {
    return skip("not enough recent data to estimate maintenance");
  }
  if (confidence !== "medium" && confidence !== "high") {
    return skip("estimate confidence too low to auto-adapt");
  }
  const delta = observedTdee - opts.currentTdee;
  if (Math.abs(delta) < noiseFloor) {
    return skip("already within the noise floor of your maintenance");
  }

  const signed = `${delta > 0 ? "+" : ""}${delta}`;
  if (Math.abs(delta) <= stepCap) {
    return {
      action: "apply",
      newTdee: observedTdee,
      deltaKcal: delta,
      reason: `auto-adjusted maintenance to ${observedTdee} kcal (${signed})`,
    };
  }
  return {
    action: "hold",
    newTdee: observedTdee,
    deltaKcal: delta,
    reason: `${observedTdee} kcal suggested (${signed}) — confirm to apply`,
  };
}
