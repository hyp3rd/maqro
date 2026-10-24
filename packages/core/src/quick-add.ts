/** Which of the day's meals a one-tap "quick add" should target, from the
 *  local time of day. Pure: the caller passes the minute of the day (the
 *  clock is injected), so web and native agree and it unit-tests trivially.
 *
 *  Slots are matched by NAME (the stable handle meal schedules and the
 *  recents use too), so renamed slots like "Brunch" or "Afternoon snack"
 *  still resolve. When the day has no slot of the time's kind the answer is
 *  `null` and the caller asks which meal instead of guessing. */

export type MealSlotKind = "breakfast" | "lunch" | "dinner" | "snack";

const MINUTES_PER_DAY = 24 * 60;

/** The eating day starts at 04:00: a 01:00 snack follows that evening's
 *  dinner, not the next morning's breakfast. */
const DAY_START = 4 * 60;

/** Where each main meal's window opens, in minutes since `DAY_START`. */
const MAIN_MEAL_STARTS: readonly (readonly [MealSlotKind, number])[] = [
  ["dinner", 17 * 60 - DAY_START],
  ["lunch", 10 * 60 + 30 - DAY_START],
  ["breakfast", 0],
];

type DayPart = "morning" | "afternoon" | "evening";

/** `minuteOfDay` floored and wrapped into [0, 1440). */
function wrapMinute(minuteOfDay: number): number {
  return (
    ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY
  );
}

/** The kind of meal a slot name describes, or `null` for a name that says
 *  nothing about the time of day ("Meal 1", "Pre-workout"). Case- and
 *  whitespace-insensitive substring match. */
export function mealSlotKind(name: string): MealSlotKind | null {
  const n = name.trim().toLowerCase();
  if (n.includes("breakfast") || n.includes("brunch")) return "breakfast";
  if (n.includes("lunch")) return "lunch";
  if (n.includes("dinner") || n.includes("supper")) return "dinner";
  if (n.includes("snack")) return "snack";
  return null;
}

/** The kind of meal the local time suggests, by half-open windows:
 *  04:00–10:30 breakfast, 10:30–15:00 lunch, 15:00–17:00 snack,
 *  17:00–22:00 dinner, 22:00–04:00 snack. `minuteOfDay` wraps into
 *  [0, 1440) and is floored, so any finite input maps deterministically. */
export function slotKindAt(minuteOfDay: number): MealSlotKind {
  const m = wrapMinute(minuteOfDay);
  if (m >= 4 * 60 && m < 10 * 60 + 30) return "breakfast";
  if (m >= 10 * 60 + 30 && m < 15 * 60) return "lunch";
  if (m >= 15 * 60 && m < 17 * 60) return "snack";
  if (m >= 17 * 60 && m < 22 * 60) return "dinner";
  return "snack";
}

/** The part of the day a slot name qualifies itself with ("Morning snack",
 *  "Late-night snack"), or `null`. Whole words only, so "Chocolate snack"
 *  says nothing about the time. */
function namedDayPart(name: string): DayPart | null {
  const n = name.toLowerCase();
  if (/\bmorning\b/.test(n)) return "morning";
  if (/\bafternoon\b/.test(n)) return "afternoon";
  if (/\b(evening|night|late|midnight|bedtime)\b/.test(n)) return "evening";
  return null;
}

/** 04:00–12:00 morning, 12:00–17:00 afternoon, 17:00–04:00 evening. */
function dayPartAt(m: number): DayPart {
  if (m >= DAY_START && m < 12 * 60) return "morning";
  if (m >= 12 * 60 && m < 17 * 60) return "afternoon";
  return "evening";
}

type Slot = { id: number; name: string; index: number };

/** Of several snack slots, the one for minute `m` (already wrapped):
 *  1. one whose name carries this part of the day ("Afternoon snack" at
 *     15:30);
 *  2. otherwise, among the slots whose name names no other part of the day
 *     (or all of them, if every one does), the first listed after the most
 *     recent main meal whose window has opened — the snack after Lunch at
 *     15:30, after Dinner at 23:00 — falling back to the last of them when
 *     none follows it, and to the first when the day has no main meal yet
 *     begun. */
function snackSlotAt(
  meals: readonly { id: number; name: string }[],
  snacks: readonly Slot[],
  m: number,
): Slot | undefined {
  const part = dayPartAt(m);
  const named = snacks.find((s) => namedDayPart(s.name) === part);
  if (named) return named;

  const unqualified = snacks.filter((s) => namedDayPart(s.name) === null);
  const pool = unqualified.length > 0 ? unqualified : snacks;

  const anchor = latestBegunMainMeal(meals, m);
  if (anchor === -1) return pool[0];
  return pool.find((s) => s.index > anchor) ?? pool[pool.length - 1];
}

/** The index (in the day's order) of the slot for the main meal whose window
 *  opened most recently by minute `m` (already wrapped) — the last one of
 *  that kind when the day lists several — stepping back to an earlier main
 *  meal when the day has no slot for it; `-1` when none has begun. */
function latestBegunMainMeal(
  meals: readonly { id: number; name: string }[],
  m: number,
): number {
  const sinceDayStart = (m - DAY_START + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  for (const [kind, start] of MAIN_MEAL_STARTS) {
    if (start > sinceDayStart) continue;
    for (let i = meals.length - 1; i >= 0; i--) {
      const meal = meals[i];
      if (meal && mealSlotKind(meal.name) === kind) return i;
    }
  }
  return -1;
}

/** The id of the meal (in the day's order) whose name matches the kind
 *  `slotKindAt(minuteOfDay)` suggests, or `null` when none does or the
 *  minute is not a finite number. Of several main-meal slots of that kind
 *  the first wins; of several snack slots, the one for the time of day
 *  (`snackSlotAt`), so a 15:30 tap on a Breakfast / Morning snack / Lunch /
 *  Afternoon snack / Dinner day targets the afternoon one. Never falls back
 *  to a different kind: logging dinner into "Snacks" because the day has no
 *  dinner slot would be a guess the user then has to undo. */
export function quickAddMealId(
  meals: readonly { id: number; name: string }[],
  minuteOfDay: number,
): number | null {
  if (!Number.isFinite(minuteOfDay)) return null;
  const m = wrapMinute(minuteOfDay);
  const kind = slotKindAt(m);
  const slots: Slot[] = [];
  meals.forEach((meal, index) => {
    if (mealSlotKind(meal.name) === kind) {
      slots.push({ id: meal.id, name: meal.name, index });
    }
  });
  const [first] = slots;
  if (!first) return null;
  if (kind !== "snack" || slots.length === 1) return first.id;
  return (snackSlotAt(meals, slots, m) ?? first).id;
}
