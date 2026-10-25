import type { TrainingDayTargets } from "@maqro/core/targets";
import type { TrainingDayClass } from "@maqro/core/training";
import type {
  TrainingDay,
  TrainingIntensity,
  TrainingType,
} from "@maqro/core/types";
import { formatClock, parseClock } from "./today/timeline";

/** The one wording set for training sessions and the days they make
 *  (English UI copy: the Profile area and Today's chip don't use
 *  next-intl). The training-week editor and its day sheet, the per-date
 *  session sheet, the Calculator's planned-day row, and Today's session chip
 *  and timeline all read from here, so a session reads the same everywhere.
 *  Sentence case, no judgement. */

/** Short names, so the longest chip ("Full body · training day · changed")
 *  still fits beside Today's "Today" button on a 360 px phone: "Upper" and
 *  "Lower" as in an upper/lower split, never "Upper body". */
export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  rest: "Rest",
  upper: "Upper",
  lower: "Lower",
  fullBody: "Full body",
  endurance: "Endurance",
  hiit: "HIIT",
  sport: "Sport",
};

export const TRAINING_INTENSITY_LABEL: Record<TrainingIntensity, string> = {
  light: "Light",
  moderate: "Moderate",
  hard: "Hard",
};

/** The kind of day a session makes for the targets, after its type in
 *  `dayTypeLabel` ("Lower · heavy day"). Only an endurance session
 *  makes an `endurance` day (`classifyTrainingDay`), so "long day" never
 *  stands without its type. */
const DAY_CLASS_LABEL: Record<TrainingDayClass, string> = {
  rest: "rest day",
  light: "light day",
  training: "training day",
  heavy: "heavy day",
  endurance: "long day",
};

/** Full weekday names indexed by `getDay()` (0 = Sunday). */
export const WEEKDAY_NAME = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Short weekday names indexed by `getDay()`. */
export const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** Display order: the week starts on Monday; values stay `getDay()`. */
export const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** "60 min", with a no-break space so it stays together when a line
 *  wraps. */
const minutes = (n: number) => `${n} min`;

/** "Moderate · 18:00 · 60 min" (and "Fasted" when it is) — the session
 *  details after its type, or "No session" for a rest day. Parts that
 *  aren't set are left out. */
export function sessionDetails(day: TrainingDay): string {
  if (day.type === "rest") return "No session";
  const parts = [
    day.intensity ? TRAINING_INTENSITY_LABEL[day.intensity] : null,
    day.time ?? null,
    day.durationMin !== undefined ? minutes(day.durationMin) : null,
    day.fasted === true ? "Fasted" : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : "No details yet";
}

/** "Lower · Hard · 18:00 · 60 min", or "Rest day". */
export function sessionLabel(day: TrainingDay): string {
  if (day.type === "rest") return "Rest day";
  const details = sessionDetails(day);
  return details === "No details yet"
    ? TRAINING_TYPE_LABEL[day.type]
    : `${TRAINING_TYPE_LABEL[day.type]} · ${details}`;
}

type DayType = Pick<TrainingDayTargets, "day" | "dayClass">;

/** "Lower · heavy day", "Full body · training day", or "Rest day":
 *  the session type and the kind of day it makes, from what
 *  `targetsForDate` resolved for it (`DateTargets.training`) or from
 *  `classifyTrainingDay` for a session being edited. */
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
  if (day.durationMin !== undefined) parts.push(minutes(day.durationMin));
  return parts.join(", ");
}
