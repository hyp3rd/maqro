import { dayOfWeek } from "./batch-apply";
import type { MealSchedule } from "./records";

/** Pure matching + formatting helpers for meal schedules — no IDB, no clock,
 *  so they unit-test trivially and the on-day offer can derive its state at
 *  render time. */

/** Schedules active on `date` (YYYY-MM-DD): the date falls within
 *  [startDate, endDate] (inclusive, string-comparable ISO dates) and its
 *  weekday is in `daysOfWeek`. */
export function schedulesForDay(
  schedules: readonly MealSchedule[],
  date: string,
): MealSchedule[] {
  const dow = dayOfWeek(date);
  return schedules.filter(
    (s) =>
      date >= s.startDate && date <= s.endDate && s.daysOfWeek.includes(dow),
  );
}

/** Does `schedule` target the meal slot named `mealName`? Case-insensitive +
 *  trimmed — schedules store lower-cased slot names. */
export function scheduleTargetsSlot(
  schedule: MealSchedule,
  mealName: string,
): boolean {
  return schedule.mealNames.includes(mealName.trim().toLowerCase());
}

const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Human label for a schedule's weekday set: "Every day", "Weekdays",
 *  "Weekends", or an abbreviated list ("Mon, Wed, Fri"). */
export function formatDaysOfWeek(daysOfWeek: readonly number[]): string {
  const set = new Set(daysOfWeek);
  if (set.size === 0) return "No days";
  if (set.size === 7) return "Every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d)))
    return "Weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return [...set]
    .sort((a, b) => a - b)
    .map((d) => DOW_ABBR[d])
    .join(", ");
}

/** Compact, timezone-safe range label for a schedule: "Jun 7 – Jul 5".
 *  Parses the ISO date by component (not `new Date(iso)`) so a negative UTC
 *  offset doesn't shift the day backward. */
export function formatScheduleRange(
  startDate: string,
  endDate: string,
): string {
  const fmt = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    if (y === undefined || m === undefined || d === undefined) return iso;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}
