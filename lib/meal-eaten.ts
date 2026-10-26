import type { Meal } from "@maqro/core/types";

/** Planned food becoming eaten food, and when a planned meal is eaten.
 *  Food is planned while it carries no `loggedAt` (see `dayIntake`); "Ate
 *  it" stamps the time it was eaten, which makes it count on Today's gauge,
 *  timeline and fasting window. Pure: the caller writes the result. */

/** The ids of a meal's foods still planned (not logged as eaten). */
export function plannedFoodIds(meal: Meal): number[] {
  return meal.foods.filter((f) => f.loggedAt === undefined).map((f) => f.id);
}

/** `meals` with meal `mealId`'s foods `foodIds` that are still planned
 *  marked eaten at `at`. A food already eaten keeps its own time. */
export function markEaten(
  meals: readonly Meal[],
  mealId: number,
  foodIds: readonly number[],
  at: number,
): Meal[] {
  const ids = new Set(foodIds);
  return meals.map((meal) =>
    meal.id !== mealId
      ? meal
      : {
          ...meal,
          foods: meal.foods.map((f) =>
            ids.has(f.id) && f.loggedAt === undefined
              ? { ...f, loggedAt: at }
              : f,
          ),
        },
  );
}

/** Undoes `markEaten(meals, mealId, foodIds, at)`: those foods planned
 *  again — each only while it still carries that `at`, so an undo never
 *  wipes a time set since. */
export function unmarkEaten(
  meals: readonly Meal[],
  mealId: number,
  foodIds: readonly number[],
  at: number,
): Meal[] {
  const ids = new Set(foodIds);
  return meals.map((meal) =>
    meal.id !== mealId
      ? meal
      : {
          ...meal,
          foods: meal.foods.map((f) => {
            if (!ids.has(f.id) || f.loggedAt !== at) return f;
            const planned = { ...f };
            delete planned.loggedAt;
            return planned;
          }),
        },
  );
}

/** `meals` with meal `mealId` planned for `time` (`HH:MM`), or back at its
 *  usual time with `undefined`. */
export function withPlannedTime(
  meals: readonly Meal[],
  mealId: number,
  time: string | undefined,
): Meal[] {
  return meals.map((meal) => {
    if (meal.id !== mealId) return meal;
    if (time !== undefined) return { ...meal, plannedTime: time };
    const usual = { ...meal };
    delete usual.plannedTime;
    return usual;
  });
}
