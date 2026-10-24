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
  const m =
    ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  if (m >= 4 * 60 && m < 10 * 60 + 30) return "breakfast";
  if (m >= 10 * 60 + 30 && m < 15 * 60) return "lunch";
  if (m >= 15 * 60 && m < 17 * 60) return "snack";
  if (m >= 17 * 60 && m < 22 * 60) return "dinner";
  return "snack";
}

/** The id of the first meal (in the day's order) whose name matches the
 *  kind `slotKindAt(minuteOfDay)` suggests, or `null` when none does or the
 *  minute is not a finite number. Never falls back to a different kind:
 *  logging dinner into "Snacks" because the day has no dinner slot would be
 *  a guess the user then has to undo. */
export function quickAddMealId(
  meals: readonly { id: number; name: string }[],
  minuteOfDay: number,
): number | null {
  if (!Number.isFinite(minuteOfDay)) return null;
  const kind = slotKindAt(minuteOfDay);
  return meals.find((meal) => mealSlotKind(meal.name) === kind)?.id ?? null;
}
