import {
  DEFAULT_GRACE_MIN,
  type EatingWindow,
  eatingWindowForDay,
  formatDuration,
  LATE_CUTOFF_HOUR,
  lateCaloriePct,
} from "./fasting";
import type { DailyLog } from "./records";
import type { Meal } from "./types";

/** Pure meal-timing analysis — first/last meal, eating-window length, and the
 *  share of calories eaten late. Mirrors `meal-insights` in shape (tone-sorted
 *  insights) but reads only `FoodItem.loggedAt`, so it stays in `@maqro/core`
 *  (no React, no I/O). Clock-time formatting (e.g. "8:42 AM") is deliberately
 *  left to the UI, which knows the user's locale; this layer deals in epochs,
 *  minutes, and percentages only. */

/** Tone of a timing insight — mirrors `MealInsightTone` so the same
 *  `InsightRow` renders both. */
export type TimingInsightTone = "good" | "warn" | "info";

export type TimingInsight = {
  tone: TimingInsightTone;
  title: string;
  detail: string;
};

/** Default share (%) of a day's calories logged after the cutoff that earns a
 *  warning. Below it (but above zero) is a neutral note. */
const LATE_CALORIE_WARN_PCT = 25;

const TONE_ORDER: Record<TimingInsightTone, number> = {
  warn: 0,
  info: 1,
  good: 2,
};

/** Render a 24h cutoff hour as a plain-English clock label ("8pm"). In-app
 *  copy is English-only (CLAUDE.md §5.4), so am/pm is fine and this keeps
 *  locale formatting out of the pure layer. */
export function formatCutoffHour(hour24: number): string {
  const h = ((Math.round(hour24) % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export type DailyTiming = {
  /** The eating window (first/last timed eat + length). */
  window: EatingWindow;
  /** Share (0–100) of the day's timed calories logged at/after the cutoff. */
  latePct: number;
};

/** The timing facts for one day, or `null` when no food carries a `loggedAt`
 *  (AI plans, pre-feature logs). Raw epochs/percentages only — clock-time
 *  formatting is a UI (locale) concern. */
export function computeDailyTiming(
  meals: Meal[],
  cutoffHour: number = LATE_CUTOFF_HOUR,
): DailyTiming | null {
  const window = eatingWindowForDay(meals);
  if (!window) return null;
  return { window, latePct: lateCaloriePct(meals, cutoffHour) };
}

/** Deterministic timing analysis of a single day: eating-window length vs the
 *  fasting target + late-calorie share. Mirrors `computeMealInsights` — an
 *  empty list when nothing is worth saying (no timed food, calm timing).
 *  Warnings sort first. */
export function computeDailyTimingInsights(input: {
  meals: Meal[];
  /** The eating-window target in hours (24 − fast hours). Omit to skip the
   *  on-protocol / over-window insight (e.g. when fasting is off). */
  eatingHoursTarget?: number;
  cutoffHour?: number;
  graceMin?: number;
  lateWarnPct?: number;
}): TimingInsight[] {
  const cutoffHour = input.cutoffHour ?? LATE_CUTOFF_HOUR;
  const graceMin = input.graceMin ?? DEFAULT_GRACE_MIN;
  const lateWarnPct = input.lateWarnPct ?? LATE_CALORIE_WARN_PCT;
  const timing = computeDailyTiming(input.meals, cutoffHour);
  if (!timing) return [];

  const out: TimingInsight[] = [];
  const { window, latePct } = timing;

  if (typeof input.eatingHoursTarget === "number") {
    const targetMin = input.eatingHoursTarget * 60 + graceMin;
    if (window.lengthMin <= targetMin) {
      out.push({
        tone: "good",
        title: "Within your eating window",
        detail: `You ate across ${formatDuration(window.lengthMin)} — inside your ${input.eatingHoursTarget}h target.`,
      });
    } else {
      out.push({
        tone: "warn",
        title: "Eating window over target",
        detail: `Your meals spanned ${formatDuration(window.lengthMin)} — past your ${input.eatingHoursTarget}h target. Tightening the first or last meal closes it.`,
      });
    }
  }

  const cutoffLabel = formatCutoffHour(cutoffHour);
  if (latePct >= lateWarnPct) {
    out.push({
      tone: "warn",
      title: "Calories late in the day",
      detail: `${latePct}% of today's calories were logged after ${cutoffLabel} — earlier meals tend to help sleep and next-day hunger.`,
    });
  } else if (latePct > 0) {
    out.push({
      tone: "info",
      title: "A little late eating",
      detail: `${latePct}% of today's calories landed after ${cutoffLabel}.`,
    });
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

export type WeeklyTiming = {
  /** Days in the window that had at least one timed food. */
  daysWithTiming: number;
  /** Mean eating-window length (minutes) across days-with-timing, or null. */
  avgWindowMin: number | null;
  /** Mean first-meal time as minutes since local midnight, or null. */
  avgFirstMinOfDay: number | null;
  /** Mean last-meal time as minutes since local midnight, or null. */
  avgLastMinOfDay: number | null;
  /** Mean late-calorie share (0–100) across days-with-timing, or null. */
  avgLatePct: number | null;
  /** Days whose window fit the protocol target (≤ target + grace). Only
   *  meaningful when `eatingHoursTarget` is supplied; 0 otherwise. */
  onProtocolDays: number;
};

/** Minutes since local midnight for an epoch instant. A day's foods all key to
 *  one local calendar day (a 00:30 snack counts to its own day — see
 *  `fasting.ts`), so this stays in `[0, 1440)` and averages cleanly. */
function minutesOfDay(epoch: number): number {
  const d = new Date(epoch);
  return d.getHours() * 60 + d.getMinutes();
}

/** Aggregate timing over a set of daily logs (the caller passes the window,
 *  e.g. the last 7 days). Averages only over days that actually have timed
 *  food — a "9h avg window" over a week where only 3 days were logged would
 *  mislead — and reports `daysWithTiming` so the UI can say "N of 7". */
export function computeWeeklyTimingInsights(
  logs: DailyLog[],
  opts: {
    eatingHoursTarget?: number;
    cutoffHour?: number;
    graceMin?: number;
  } = {},
): WeeklyTiming {
  const cutoffHour = opts.cutoffHour ?? LATE_CUTOFF_HOUR;
  const graceMin = opts.graceMin ?? DEFAULT_GRACE_MIN;
  const targetMin =
    typeof opts.eatingHoursTarget === "number"
      ? opts.eatingHoursTarget * 60 + graceMin
      : null;

  let days = 0;
  let sumWindow = 0;
  let sumFirst = 0;
  let sumLast = 0;
  let sumLate = 0;
  let onProtocol = 0;
  for (const log of logs) {
    const window = eatingWindowForDay(log.meals);
    if (!window) continue;
    days += 1;
    sumWindow += window.lengthMin;
    sumFirst += minutesOfDay(window.firstAt);
    sumLast += minutesOfDay(window.lastAt);
    sumLate += lateCaloriePct(log.meals, cutoffHour);
    if (targetMin !== null && window.lengthMin <= targetMin) onProtocol += 1;
  }
  if (days === 0) {
    return {
      daysWithTiming: 0,
      avgWindowMin: null,
      avgFirstMinOfDay: null,
      avgLastMinOfDay: null,
      avgLatePct: null,
      onProtocolDays: 0,
    };
  }
  return {
    daysWithTiming: days,
    avgWindowMin: Math.round(sumWindow / days),
    avgFirstMinOfDay: Math.round(sumFirst / days),
    avgLastMinOfDay: Math.round(sumLast / days),
    avgLatePct: Math.round(sumLate / days),
    onProtocolDays: onProtocol,
  };
}
