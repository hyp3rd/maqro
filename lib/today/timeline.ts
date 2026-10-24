import type { Meal, TrainingDay } from "@maqro/core/types";

/** Geometry and wording of the Today 24-hour timing track. Pure: the date,
 *  today's key and the clock are inputs, so the track renders the same in
 *  tests, on the server and in a future native client.
 *
 *  The track is the WALL CLOCK of one local calendar day, 00:00 → 24:00:
 *  an instant is placed by its local hours and minutes, never by elapsed
 *  milliseconds since midnight, so a 23- or 25-hour daylight-saving day
 *  still puts a 14:00 meal at 14:00. */

export const DAY_MINUTES = 24 * 60;

/** Where a date sits relative to today (`YYYY-MM-DD` keys order
 *  lexicographically). Drives the day-aware wording and what is "now". */
export type RelativeDay = "past" | "today" | "future";

export function relativeDay(date: string, today: string): RelativeDay {
  if (date === today) return "today";
  return date < today ? "past" : "future";
}

/** Local midnight `Date` of a `YYYY-MM-DD` key, built from its components
 *  (never parsed as UTC), for naming the day in the user's locale. */
export function localDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? Number.NaN, (m ?? Number.NaN) - 1, d ?? Number.NaN);
}

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

/** Position on the track, as a percentage of its width, clamped. */
export function trackPercent(minutes: number): number {
  return (Math.min(Math.max(minutes, 0), DAY_MINUTES) / DAY_MINUTES) * 100;
}

/** How much of the day has passed: all of a past day, none of a future
 *  one, and up to `now` today. `now` ≤ 0 is the server snapshot of the
 *  clock (not known yet): nothing is lit. */
export function elapsedMinutes(
  date: string,
  today: string,
  now: number,
): number {
  const when = relativeDay(date, today);
  if (when === "past") return DAY_MINUTES;
  if (when === "future" || now <= 0) return 0;
  return minuteOfDay(now, date) ?? 0;
}

/** The minute the meal's first timed food was logged on `date`, or `null`
 *  when none of its foods carries a `loggedAt` on that day (planned,
 *  copied or AI-filled foods have no time and stay off the track). */
export function mealStartMinute(meal: Meal, date: string): number | null {
  let first: number | null = null;
  for (const food of meal.foods) {
    if (food.loggedAt === undefined) continue;
    const minute = minuteOfDay(food.loggedAt, date);
    if (minute !== null && (first === null || minute < first)) first = minute;
  }
  return first;
}

/** One meal on the track: at its first logged food, labelled with the
 *  whole meal's kcal. `lane` 1 lifts a label that would overlap the
 *  previous one in lane 0. */
export type MealTick = {
  mealId: number;
  name: string;
  minutes: number;
  kcal: number;
  lane: 0 | 1;
};

/** Minutes two kcal labels need between them to sit side by side (a
 *  "720" label is about 1.5 h of a phone-width track). */
const LABEL_GAP_MIN = 100;

export function mealTicks(meals: readonly Meal[], date: string): MealTick[] {
  const timed = meals
    .map((meal) => ({ meal, minutes: mealStartMinute(meal, date) }))
    .filter((t): t is { meal: Meal; minutes: number } => t.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  const lastInLane: [number, number] = [-Infinity, -Infinity];
  return timed.map(({ meal, minutes }) => {
    // Lane 0 when it has room, else lane 1 when that has room; with both
    // taken (three meals within ~1.5 h) the label shares lane 0.
    const lane: 0 | 1 =
      minutes - lastInLane[0] >= LABEL_GAP_MIN
        ? 0
        : minutes - lastInLane[1] >= LABEL_GAP_MIN
          ? 1
          : 0;
    lastInLane[lane] = minutes;
    return {
      mealId: meal.id,
      name: meal.name,
      minutes,
      kcal: Math.round(meal.foods.reduce((sum, f) => sum + f.calories, 0)),
      lane,
    };
  });
}

/** A block of time on the track. Today only the planned workout; the
 *  pre/post-workout eating windows join this union when they ship, and
 *  the track draws each kind in its own style. */
export type TimelineSpan = {
  kind: "workout";
  startMin: number;
  endMin: number;
  /** The session as the day-type chip names it ("Lower · heavy day"). */
  label: string;
};

/** The planned session of a training template day: from its start time
 *  for its duration (a point when the length is unknown), ending at
 *  midnight rather than wrapping into tomorrow. No session, a rest day or
 *  an unknown start time → `null` (it can't be placed). */
export function workoutSpan(
  day: TrainingDay | undefined,
  label: string,
): TimelineSpan | null {
  if (!day || day.type === "rest") return null;
  const startMin = parseClock(day.time);
  if (startMin === null) return null;
  const length = day.durationMin ?? 0;
  return {
    kind: "workout",
    startMin,
    endMin: Math.min(startMin + Math.max(length, 0), DAY_MINUTES),
    label,
  };
}

/** The hour marks labelled under the track. */
export const HOUR_MARKS = [0, 6, 12, 18, 24] as const;

/** Minutes either side of "now" an hour label would collide with the
 *  "Now HH:MM" flag on a phone-width track. */
const NOW_LABEL_CLEAR_MIN = 200;

/** The hour marks to label, leaving room for the now flag. */
export function hourLabels(nowMinute: number | null): number[] {
  return HOUR_MARKS.filter(
    (h) =>
      nowMinute === null || Math.abs(h * 60 - nowMinute) >= NOW_LABEL_CLEAR_MIN,
  );
}

/** Minutes from either end of the track within which a label anchors to
 *  that end so it stays inside the track. */
const EDGE_MIN = 90;

export function labelAnchor(minutes: number): "start" | "middle" | "end" {
  if (minutes < EDGE_MIN) return "start";
  if (minutes > DAY_MINUTES - EDGE_MIN) return "end";
  return "middle";
}

/** What the track shows, in words — its accessible name. `formatKcal`
 *  prints a kcal figure for the app locale, as the track's labels do. */
export function timelineSummary(input: {
  ticks: readonly MealTick[];
  spans: readonly TimelineSpan[];
  nowMinute: number | null;
  formatKcal: (kcal: number) => string;
}): string {
  const parts = [
    ...input.ticks.map(
      (t) =>
        `${t.name} at ${formatClock(t.minutes)}, ${input.formatKcal(t.kcal)} kcal.`,
    ),
    ...input.spans.map((s) =>
      s.endMin > s.startMin
        ? `Workout, ${s.label}, ${formatClock(s.startMin)} to ${formatClock(s.endMin)}.`
        : `Workout, ${s.label}, at ${formatClock(s.startMin)}.`,
    ),
  ];
  if (parts.length === 0) parts.push("No timed meals yet.");
  if (input.nowMinute !== null)
    parts.push(`Now ${formatClock(input.nowMinute)}.`);
  return parts.join(" ");
}
