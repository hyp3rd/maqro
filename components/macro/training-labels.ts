import type { TrainingDayClass } from "@maqro/core/training";
import type {
  TrainingDay,
  TrainingIntensity,
  TrainingType,
} from "@maqro/core/types";

/** English UI copy for the training template (the Profile area doesn't use
 *  next-intl). Shared by the training-week editor and the Calculator's
 *  planned-day line so a session reads the same everywhere. */

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  rest: "Rest",
  upper: "Upper body",
  lower: "Lower body",
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

/** What a planned day is, in a few calm words. */
export const DAY_CLASS_LABEL: Record<TrainingDayClass, string> = {
  rest: "Rest day",
  light: "Light day",
  training: "Training day",
  heavy: "Heavy training day",
  endurance: "Long endurance day",
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

/** "Moderate · 18:00 · 60 min" — the session details after its type, or
 *  "No session" for a rest day. Parts that aren't set are left out. */
export function sessionDetails(day: TrainingDay): string {
  if (day.type === "rest") return "No session";
  const parts = [
    day.intensity ? TRAINING_INTENSITY_LABEL[day.intensity] : null,
    day.time ?? null,
    // A no-break space keeps "60 min" together when the line wraps.
    day.durationMin !== undefined ? `${day.durationMin} min` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : "No details yet";
}
