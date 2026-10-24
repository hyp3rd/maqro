import type { TrainingDayTargets } from "@maqro/core/targets";
import type { TrainingDayClass } from "@maqro/core/training";
import type { TrainingType } from "@maqro/core/types";
import { formatClock, parseClock } from "./timeline";

/** Words for a planned training day, from what `targetsForDate` resolved
 *  for it (`DateTargets.training`): the session type and the kind of day it
 *  makes for the targets. Sentence case, no judgement. */

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  rest: "Rest",
  upper: "Upper",
  lower: "Lower",
  fullBody: "Full body",
  endurance: "Endurance",
  hiit: "HIIT",
  sport: "Sport",
};

const DAY_CLASS_LABEL: Record<TrainingDayClass, string> = {
  rest: "rest day",
  light: "light day",
  training: "training day",
  heavy: "heavy day",
  endurance: "long day",
};

type DayType = Pick<TrainingDayTargets, "day" | "dayClass">;

/** "Lower · heavy day", "Full body · training day", or "Rest day". */
export function dayTypeLabel({ day, dayClass }: DayType): string {
  if (day.type === "rest") return "Rest day";
  return `${TRAINING_TYPE_LABEL[day.type]} · ${DAY_CLASS_LABEL[dayClass]}`;
}

/** The same in full for assistive tech, with the planned start and length
 *  when the template has them: "Lower, heavy day, 18:00, 75 min". */
export function dayTypeDescription({ day, dayClass }: DayType): string {
  if (day.type === "rest") return "Rest day";
  const parts = [TRAINING_TYPE_LABEL[day.type], DAY_CLASS_LABEL[dayClass]];
  const start = parseClock(day.time);
  if (start !== null) parts.push(formatClock(start));
  if (day.durationMin !== undefined) parts.push(`${day.durationMin} min`);
  return parts.join(", ");
}
