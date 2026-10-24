import type { DateTargets } from "@maqro/core/targets";
import type { TrainingDayClass } from "@maqro/core/training";
import { formatClock, parseClock, type RelativeDay } from "./timeline";

/** The calm line under the Today gauge on a training day: which macro the
 *  day's planned session moved and why — "Carbs are higher today — heavy
 *  session at 18:00". Pure: worded from the shown day's resolved targets
 *  alone (`DateTargets.training` and its macros).
 *
 *  What the session moved is the day's carbs and fat against the same day
 *  planned at the weekly mean (`training.meanDay`: same week, protein and
 *  held level, no calorie shift) — never against the other days of the
 *  week, whose targets also carry a goal phase that starts mid-week (Pro)
 *  or another day's override, neither of which is this session's doing.
 *  Calorie cycling lands on carbs (fat stays one level all week) except
 *  for a fat-moving diet, which mirrors it, so whichever of the two moved
 *  further (in kcal) is named. Nothing is said on a rest day, with
 *  training off, or when the session left the day at the weekly average
 *  (cycling off, or a session that didn't move it): then there is nothing
 *  to explain. Never a judgement — a planned difference, stated. */

const SESSION: Record<Exclude<TrainingDayClass, "rest">, string> = {
  light: "light session",
  training: "training session",
  heavy: "heavy session",
  endurance: "long session",
};

/** Less than this many kcal from the mean day is "the same": the day
 *  targets sit on a 50 kcal / 5 g grid. */
const SAME_KCAL = 25;

type DayTargets = Pick<DateTargets, "carbs" | "fat" | "training">;

/** `dayPhrase` names the shown day as the line speaks of it: "today",
 *  "tomorrow", "on Friday". */
export function trainingContextLine(
  day: DayTargets,
  when: RelativeDay,
  dayPhrase: string,
): string | null {
  const training = day.training;
  if (!training || training.day.type === "rest" || training.dayClass === "rest")
    return null;
  const carbsKcal = (day.carbs - training.meanDay.carbs) * 4;
  const fatKcal = (day.fat - training.meanDay.fat) * 9;
  const fatMoved = Math.abs(fatKcal) > Math.abs(carbsKcal);
  const shift = fatMoved ? fatKcal : carbsKcal;
  if (!(Math.abs(shift) >= SAME_KCAL)) return null;

  const past = when === "past";
  const verb = fatMoved ? (past ? "was" : "is") : past ? "were" : "are";
  const macro = fatMoved ? "Fat" : "Carbs";
  const session = SESSION[training.dayClass];
  const start = parseClock(training.day.time);
  const at = start !== null ? ` at ${formatClock(start)}` : "";
  if (shift > 0) {
    return start !== null
      ? `${macro} ${verb} higher ${dayPhrase} — ${session}${at}`
      : `${macro} ${verb} higher ${dayPhrase} for the ${session}`;
  }
  // A session that leaves the day UNDER the weekly average (a light one in
  // a week of harder ones): "lower … — light session" reads as if the
  // session took food away, so the line says the day was planned to suit
  // it. Kept as short as the "higher" line: it sits under the gauge on the
  // fold, one line at 390 and on desktop.
  return `${macro} ${verb} lower ${dayPhrase} to match the ${session}${at}`;
}
