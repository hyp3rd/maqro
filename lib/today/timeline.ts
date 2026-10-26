import {
  DAY_MINUTES,
  formatClock,
  mealStartMinute,
  minuteOfDay,
  parseClock,
} from "@maqro/core/clock";
import { type MealTimeContext, mealMinute } from "@maqro/core/meal-order";
import type { Meal, TrainingDay, WorkoutMealRole } from "@maqro/core/types";
import type { WorkoutMealsPlan } from "@maqro/core/workout-meals";

/** Geometry and wording of the Today 24-hour timing track. Pure: the date,
 *  today's key and the clock are inputs, so the track renders the same in
 *  tests, on the server and in a future native client.
 *
 *  The track is the WALL CLOCK of one local calendar day, 00:00 → 24:00
 *  (`@maqro/core/clock`, re-exported here for the track's callers). */

export { DAY_MINUTES, formatClock, mealStartMinute, minuteOfDay, parseClock };

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

/** One meal on the track. An eaten meal sits at its first food logged
 *  that day, labelled with the kcal logged as eaten (on a past day, all of
 *  its food — the day can't tell eaten from planned). A planned meal — on
 *  today or a future day, food with none of it logged as eaten, as the
 *  rail's planned node — sits at the time it is planned for
 *  (`mealMinute`), labelled with its kcal, and is drawn hollow; one with
 *  no time (Snacks, an untimed workout meal) stays off the track. `lane` 1
 *  lifts a label that would overlap the previous one in lane 0; `null` =
 *  no label, because both lanes are taken there (the tick stays, and the
 *  meal's kcal is in the track's summary and on the rail). */
export type MealTick = {
  mealId: number;
  name: string;
  minutes: number;
  kcal: number;
  planned: boolean;
  lane: 0 | 1 | null;
};

/** The narrowest track the day view lays out: a 320px viewport less its
 *  16px gutters. */
export const NARROWEST_TRACK_PX = 288;
/** The advance of one 12px mono glyph (Geist Mono: 0.6em). */
const LABEL_CHAR_PX = 7.2;

/** Track minutes one label character takes on a track `trackPx` wide. */
function minutesPerChar(trackPx: number): number {
  return (LABEL_CHAR_PX * DAY_MINUTES) / trackPx;
}

/** Track minutes one label character takes on the narrowest track (0.2px
 *  a minute). A wider track only leaves more room. A "720" label is then
 *  about 1.8 h. */
const MIN_PER_LABEL_CHAR = minutesPerChar(NARROWEST_TRACK_PX);
/** The clear gap kept between two labels in a lane: one character, so
 *  two figures never read as one ("1,821 437"). */
const LABEL_PAD_MIN = MIN_PER_LABEL_CHAR;

/** Characters in a kcal label at most: its digits plus a grouping mark
 *  per thousand (the locale may print fewer, never more). */
function labelChars(kcal: number): number {
  const digits = String(Math.max(0, Math.round(kcal))).length;
  return digits + Math.floor((digits - 1) / 3);
}

/** The track minutes a label covers, placed as `labelAnchor` places it:
 *  centred on its tick, or running inwards from a tick near an end. */
function labelExtent(
  minutes: number,
  chars: number,
  perChar: number = MIN_PER_LABEL_CHAR,
): { from: number; to: number } {
  const width = chars * perChar;
  switch (labelAnchor(minutes)) {
    case "start":
      return { from: minutes, to: minutes + width };
    case "end":
      return { from: minutes - width, to: minutes };
    case "middle":
      return { from: minutes - width / 2, to: minutes + width / 2 };
  }
}

/** `meals`' ticks on `ctx.date`, a day that is `when`, in time order. */
export function mealTicks(
  meals: readonly Meal[],
  ctx: MealTimeContext,
  when: RelativeDay,
): MealTick[] {
  const timed: {
    meal: Meal;
    minutes: number;
    kcal: number;
    planned: boolean;
  }[] = [];
  for (const meal of meals) {
    if (meal.foods.length === 0) continue;
    const eaten =
      when === "past"
        ? meal.foods
        : meal.foods.filter((f) => f.loggedAt !== undefined);
    const planned = eaten.length === 0;
    const minutes = planned
      ? mealMinute(meal, ctx)
      : mealStartMinute(meal, ctx.date);
    if (minutes === null) continue;
    const kcal = Math.round(
      (planned ? meal.foods : eaten).reduce((sum, f) => sum + f.calories, 0),
    );
    timed.push({ meal, minutes, kcal, planned });
  }
  timed.sort((a, b) => a.minutes - b.minutes);
  // Where the last label placed in each lane ends. Ticks come in time
  // order and every label covers its own tick, so a later label can only
  // collide with the previous one's right end.
  const laneEnd: [number | null, number | null] = [null, null];
  const fits = (lane: 0 | 1, from: number) => {
    const end = laneEnd[lane];
    return end === null || from - end >= LABEL_PAD_MIN;
  };
  return timed.map(({ meal, minutes, kcal, planned }) => {
    const extent = labelExtent(minutes, labelChars(kcal));
    // Lane 0 when it has room, else lane 1 when that has room; with both
    // taken (three meals close together) the label is left off rather
    // than printed over another.
    const lane = fits(0, extent.from) ? 0 : fits(1, extent.from) ? 1 : null;
    if (lane !== null) laneEnd[lane] = extent.to;
    return { mealId: meal.id, name: meal.name, minutes, kcal, planned, lane };
  });
}

/** A block of time on the track: the planned workout, or the eating window
 *  of one of the day's workout meals. The track draws each kind in its own
 *  style. */
export type TimelineSpan = {
  kind: "workout" | WorkoutMealRole;
  startMin: number;
  endMin: number;
  /** The session as the day-type chip names it ("Lower · heavy day"), or
   *  the workout meal's name. */
  label: string;
};

/** The eating windows of the day's workout meals, in time order; an untimed
 *  meal has none. */
export function workoutMealSpans(
  plan: WorkoutMealsPlan | null,
): TimelineSpan[] {
  const spans: TimelineSpan[] = [];
  for (const slot of [plan?.pre, plan?.post]) {
    if (!slot?.window) continue;
    spans.push({
      kind: slot.role,
      startMin: slot.window.start,
      endMin: slot.window.end,
      label: slot.name,
    });
  }
  return spans;
}

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

/** Characters in an hour label ("18"). */
const HOUR_LABEL_CHARS = 2;
/** The clear gap kept between the now flag and an hour label: half a
 *  character, so "18" never touches "Now 15:00". */
const NOW_LABEL_PAD_CHARS = 0.5;
/** The clear room the full flag keeps from an hour label on each side:
 *  a whole character. Where the half-character `NOW_LABEL_PAD_CHARS` is
 *  all that's left, the flag reads cramped beside 12 and 18 (~5 px on a
 *  390 px phone) next to the short flag on a 320 or 360 px phone
 *  (11-16 px), so it stays short there too. */
const FULL_NOW_PAD_CHARS = 1;
/** The "Now HH:MM" flag (9 characters) with an hour label's half and a
 *  pad on each side: what one 6-hour gap between hour labels must hold for
 *  the flag to sit between them (15:00 between 12 and 18). */
const FULL_NOW_GAP_CHARS = 9 + HOUR_LABEL_CHARS + 2 * FULL_NOW_PAD_CHARS;
/** The narrowest track (px) whose 6-hour gaps hold the full flag: about
 *  374 px, so every phone up to 390 px (a 358 px track) reads just
 *  "15:00" beside the signal cursor, and the desktop column (384 px) and
 *  wider read "Now 15:00". */
const FULL_NOW_MIN_TRACK_PX =
  (FULL_NOW_GAP_CHARS * LABEL_CHAR_PX * DAY_MINUTES) / (6 * 60);

/** A measured track width, or the narrowest track's when it isn't known
 *  (the server, the first render). */
function usableTrackPx(trackPx: number): number {
  return Number.isFinite(trackPx) && trackPx > 0 ? trackPx : NARROWEST_TRACK_PX;
}

/** The now flag's text on a track `trackPx` wide: "Now 15:00" where an
 *  hour gap holds it, else just the time (the signal-coloured cursor
 *  marks it as now, and the track's accessible summary says "Now 15:00"),
 *  so 12 and 18 stay readable mid-afternoon on a narrow phone. */
export function nowFlagText(
  nowMinute: number,
  trackPx: number = NARROWEST_TRACK_PX,
): string {
  const clock = formatClock(nowMinute);
  return usableTrackPx(trackPx) >= FULL_NOW_MIN_TRACK_PX
    ? `Now ${clock}`
    : clock;
}

/** The hour marks to label: every one except those the now flag
 *  (`nowFlagText`) actually overlaps on a track `trackPx` wide, both
 *  placed as `labelAnchor` places them (at 15:00, 12 and 18 both stay on
 *  every phone width). The width is measured; until it is (the server,
 *  the first render) the narrowest track's is assumed. */
export function hourLabels(
  nowMinute: number | null,
  trackPx: number = NARROWEST_TRACK_PX,
): number[] {
  if (nowMinute === null) return [...HOUR_MARKS];
  const perChar = minutesPerChar(usableTrackPx(trackPx));
  const pad = NOW_LABEL_PAD_CHARS * perChar;
  const now = labelExtent(
    nowMinute,
    nowFlagText(nowMinute, trackPx).length,
    perChar,
  );
  return HOUR_MARKS.filter((h) => {
    const label = labelExtent(h * 60, HOUR_LABEL_CHARS, perChar);
    return label.to + pad <= now.from || label.from - pad >= now.to;
  });
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
        `${t.name}${t.planned ? " planned" : ""} at ${formatClock(t.minutes)}, ${input.formatKcal(t.kcal)} kcal.`,
    ),
    ...input.spans.map((s) => {
      if (s.kind !== "workout") {
        return `${s.label} window, ${formatClock(s.startMin)} to ${formatClock(s.endMin)}.`;
      }
      return s.endMin > s.startMin
        ? `Workout, ${s.label}, ${formatClock(s.startMin)} to ${formatClock(s.endMin)}.`
        : `Workout, ${s.label}, at ${formatClock(s.startMin)}.`;
    }),
  ];
  if (parts.length === 0) parts.push("No timed meals yet.");
  if (input.nowMinute !== null)
    parts.push(`Now ${formatClock(input.nowMinute)}.`);
  return parts.join(" ");
}
