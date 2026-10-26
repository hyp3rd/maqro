import type { Meal } from "./types";

/** Wall-clock minutes of one local calendar day, 00:00 → 24:00. An instant is
 *  placed by its local hours and minutes, never by elapsed milliseconds since
 *  midnight, so a 23- or 25-hour daylight-saving day still puts a 14:00 meal
 *  at 14:00. Shared by the Today timing track and the workout-meal timing. */

export const DAY_MINUTES = 24 * 60;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight of a 24 h `HH:MM` (the training template's
 *  format), or `null` for anything else. */
export function parseClock(hhmm: string | undefined): number | null {
  const match = hhmm === undefined ? null : CLOCK.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `HH:MM` (24 h) for a minute of the day; 1440 reads "24:00". */
export function formatClock(minutes: number): string {
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The local wall-clock minute (0–1439) of epoch `ms` when it falls on the
 *  calendar day `date`; `null` for another day or a non-instant. */
export function minuteOfDay(ms: number, date: string): number | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (localDateKey(d) !== date) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/** Epoch ms of the local wall-clock `minute` (0–1439) on the calendar day
 *  `date` (`YYYY-MM-DD`): the inverse of `minuteOfDay`. A minute a
 *  daylight-saving switch skips lands on the one after the gap. */
export function localInstant(date: string, minute: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(
    y ?? Number.NaN,
    (m ?? Number.NaN) - 1,
    d ?? Number.NaN,
    Math.floor(minute / 60),
    minute % 60,
  ).getTime();
}

/** The minute the meal's first timed food was logged on `date`, or `null`
 *  when none of its foods carries a `loggedAt` on that day (planned,
 *  copied or AI-filled foods have no time). */
export function mealStartMinute(meal: Meal, date: string): number | null {
  let first: number | null = null;
  for (const food of meal.foods) {
    if (food.loggedAt === undefined) continue;
    const minute = minuteOfDay(food.loggedAt, date);
    if (minute !== null && (first === null || minute < first)) first = minute;
  }
  return first;
}
