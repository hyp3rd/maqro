import type { Meal, TotalMacros } from "@maqro/core/types";
import type { RelativeDay } from "./timeline";

/** A day's food split into what was eaten and what is still planned, for
 *  Today's gauge and readout. Only today can tell the two apart: a food
 *  logged as eaten there carries a `loggedAt`, a planned one (an AI
 *  Auto-fill, food put down for later) doesn't. Another day keeps its single total as
 *  `eaten` — a past day's food counts as eaten (logging to it never stamps
 *  a time), a future day's is all plan and the gauge words it as such — so
 *  `planned` is only ever non-zero on today. Rounded like the day's totals. */
export type DayIntake = { eaten: TotalMacros; planned: TotalMacros };

export function dayIntake(
  meals: readonly Meal[],
  when: RelativeDay,
): DayIntake {
  const eaten = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  const planned = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  for (const meal of meals) {
    for (const food of meal.foods) {
      const into =
        when === "today" && food.loggedAt === undefined ? planned : eaten;
      into.protein += food.protein;
      into.carbs += food.carbs;
      into.fat += food.fat;
      into.calories += food.calories;
    }
  }
  const round = (m: TotalMacros): TotalMacros => ({
    protein: Math.round(m.protein),
    carbs: Math.round(m.carbs),
    fat: Math.round(m.fat),
    calories: Math.round(m.calories),
  });
  return { eaten: round(eaten), planned: round(planned) };
}
