import { mealStartMinute } from "./clock";
import type { DailyLog } from "./records";
import type { Meal } from "./types";
import { type WorkoutMealsPlan, workoutRole } from "./workout-meals";

/** Where a training day's workout meals sit among the regular meals. The
 *  regular meals keep their order; each workout meal goes before the first
 *  regular meal that comes at or after it in the day, and never after
 *  Snacks, which stays last (snacks happen all day, so they have no one
 *  time). A meal's time is when its first food was logged that day, else
 *  its usual time from recent days (`usualMealMinutes`), else a default;
 *  a workout meal's is the plan's aim. Pure. */

/** The id of Snacks, the regular meal that always stays last. */
export const SNACKS_MEAL_ID = 4;

/** A regular meal's time before there is history: Breakfast 08:00, Lunch
 *  12:30, Dinner 19:30. */
export const DEFAULT_MEAL_MINUTES: Readonly<Record<number, number>> = {
  1: 8 * 60,
  2: 12 * 60 + 30,
  3: 19 * 60 + 30,
};

/** How many recent days the caller reads for the usual times, and how many
 *  days a meal needs a logged time on before its usual time counts. */
export const USUAL_TIME_LOOKBACK_DAYS = 28;
export const USUAL_TIME_MIN_DAYS = 3;

/** A regular meal's usual minute of the day, by meal id. */
export type UsualMealMinutes = Partial<Record<number, number>>;

/** The middle minute of an ascending list, rounded to a whole minute. */
function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Each regular meal's usual time over `logs` (the caller passes the last
 *  `USUAL_TIME_LOOKBACK_DAYS`, today excluded): the median minute its first
 *  food was logged, for a meal with a logged time on at least
 *  `USUAL_TIME_MIN_DAYS` days. Untimed foods (plans, back-filled or copied
 *  days) don't count. */
export function usualMealMinutes(logs: readonly DailyLog[]): UsualMealMinutes {
  const byId = new Map<number, number[]>();
  for (const log of logs) {
    for (const meal of log.meals) {
      if (workoutRole(meal) !== null || meal.id === SNACKS_MEAL_ID) continue;
      const minute = mealStartMinute(meal, log.date);
      if (minute === null) continue;
      const list = byId.get(meal.id) ?? [];
      list.push(minute);
      byId.set(meal.id, list);
    }
  }
  const out: UsualMealMinutes = {};
  for (const [id, minutes] of byId) {
    if (minutes.length < USUAL_TIME_MIN_DAYS) continue;
    out[id] = median([...minutes].sort((a, b) => a - b));
  }
  return out;
}

/** `meals` (`dayMealsWithWorkout`'s list) in the order to show on `date`. */
export function orderDayMeals(
  meals: readonly Meal[],
  input: {
    date: string;
    usual: UsualMealMinutes;
    plan: WorkoutMealsPlan | null;
  },
): Meal[] {
  const minuteOf = (meal: Meal): number | null => {
    const logged = mealStartMinute(meal, input.date);
    if (logged !== null) return logged;
    const role = workoutRole(meal);
    if (role !== null) {
      const slot = role === "preWorkout" ? input.plan?.pre : input.plan?.post;
      return slot?.aimMinute ?? null;
    }
    return input.usual[meal.id] ?? DEFAULT_MEAL_MINUTES[meal.id] ?? null;
  };
  const out = meals.filter((m) => workoutRole(m) === null);
  // Pre-workout first, so the post-workout meal is placed after it.
  const rank = (m: Meal) => (workoutRole(m) === "preWorkout" ? 0 : 1);
  const workout = meals
    .filter((m) => workoutRole(m) !== null)
    .sort((a, b) => rank(a) - rank(b));
  for (const meal of workout) {
    const snacks = out.findIndex(
      (m) => workoutRole(m) === null && m.id === SNACKS_MEAL_ID,
    );
    const tail = snacks === -1 ? out.length : snacks;
    // Never before a pre-workout meal already placed.
    const first = out.findIndex((m) => workoutRole(m) === "preWorkout") + 1;
    const minute = minuteOf(meal);
    let at = Math.max(tail, first);
    if (minute !== null) {
      const later = out.findIndex((m, i) => {
        if (i < first || i >= tail) return false;
        const other = minuteOf(m);
        return other !== null && other >= minute;
      });
      if (later !== -1) at = later;
    }
    out.splice(at, 0, meal);
  }
  return out;
}
