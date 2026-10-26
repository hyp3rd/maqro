import type { Meal } from "@maqro/core/types";
import { type RelativeDay, relativeDay } from "./timeline";

/** The Today week strip: Monday → Sunday, each day's eaten kcal against
 *  THAT day's own target (planned per-day targets, never a weekly sum —
 *  no banking, no rebalancing). Pure.
 *
 *  Every bar ends at the same target tick, so the seven days line up and
 *  read at a glance; an overshoot is a faint nub past the tick drawn to
 *  scale (110 over 1,950 is about two pixels — calm by design) with a
 *  neutral "+N" beside it. */

/** Where the target tick sits along each bar (the rest is room for a nub). */
export const STRIP_TICK = 0.85;

/** Fractions of the bar's width: the fill up to the tick, and the nub past
 *  it (capped at the bar's end). */
export type StripBar = { fill: number; nub: number };

export function stripBar(eaten: number, target: number): StripBar {
  const e = Number.isFinite(eaten) && eaten > 0 ? eaten : 0;
  if (!(Number.isFinite(target) && target > 0)) return { fill: 0, nub: 0 };
  const ratio = e / target;
  return {
    fill: Math.min(ratio, 1) * STRIP_TICK,
    nub: Math.min(Math.max(ratio - 1, 0) * STRIP_TICK, 1 - STRIP_TICK),
  };
}

/** A day's kcal on the strip, for a day that is `when`: all of its food,
 *  but on today only what was logged as eaten — food planned for later
 *  isn't eaten yet (the gauge shows it, dashed; see `dayIntake`). */
export function dayCalories(meals: readonly Meal[], when: RelativeDay): number {
  let sum = 0;
  for (const meal of meals) {
    for (const food of meal.foods) {
      if (when === "today" && food.loggedAt === undefined) continue;
      if (Number.isFinite(food.calories)) sum += food.calories;
    }
  }
  return sum;
}

export type StripDay = {
  date: string;
  when: RelativeDay;
  /** The day the view is showing (need not be today). */
  selected: boolean;
  /** That day's own target and its intake, rounded as shown. */
  target: number;
  eaten: number;
  /** Shown intake minus shown target when positive — the neutral "+N". */
  over: number;
  bar: StripBar;
};

export function weekStripDays(
  days: readonly { date: string; targetCalories: number }[],
  eatenByDate: ReadonlyMap<string, number>,
  today: string,
  selectedDate: string,
): StripDay[] {
  return days.map(({ date, targetCalories }) => {
    const target = Number.isFinite(targetCalories)
      ? Math.max(Math.round(targetCalories), 0)
      : 0;
    const raw = eatenByDate.get(date) ?? 0;
    const eaten = Number.isFinite(raw) ? Math.max(Math.round(raw), 0) : 0;
    return {
      date,
      when: relativeDay(date, today),
      selected: date === selectedDate,
      target,
      eaten,
      over: target > 0 ? Math.max(eaten - target, 0) : 0,
      bar: stripBar(eaten, target),
    };
  });
}
