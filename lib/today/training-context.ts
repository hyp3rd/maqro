import type { DateTargets } from "@maqro/core/targets";
import type { TrainingDayClass } from "@maqro/core/training";
import { formatClock, parseClock, type RelativeDay } from "./timeline";

/** The calm line under the Today gauge on a training day: which macro the
 *  day's planned session moved and why — "Carbs are higher today — heavy
 *  session at 18:00". Pure: worded from the shown day's resolved targets
 *  (`DateTargets.training` and its macros) against its own week.
 *
 *  The moving macro is read from the week rather than the diet setting:
 *  calorie cycling lands on carbs (fat stays one level all week) except
 *  for a fat-moving diet, which mirrors it — so whichever of the two sits
 *  further (in kcal) from its weekly average is the one the day moved.
 *  Nothing is said on a rest day, with training off, or when the day sits
 *  at the weekly average (cycling off, or a session that didn't move it):
 *  then there is nothing to explain. Never a judgement — a planned
 *  difference, stated. */

const SESSION: Record<Exclude<TrainingDayClass, "rest">, string> = {
  light: "light session",
  training: "training session",
  heavy: "heavy session",
  endurance: "long session",
};

/** Less than this many kcal from the weekly average is "the same": the
 *  day targets sit on a 50 kcal / 5 g grid. */
const SAME_KCAL = 25;

type DayTargets = Pick<DateTargets, "date" | "carbs" | "fat" | "training">;

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** `dayPhrase` names the shown day as the line speaks of it: "today",
 *  "tomorrow", "on Friday". */
export function trainingContextLine(
  day: DayTargets,
  week: { days: readonly Pick<DateTargets, "date" | "carbs" | "fat">[] } | null,
  when: RelativeDay,
  dayPhrase: string,
): string | null {
  const training = day.training;
  if (!training || training.day.type === "rest" || training.dayClass === "rest")
    return null;
  if (!week || !week.days.some((d) => d.date === day.date)) return null;
  const carbsKcal = (day.carbs - mean(week.days.map((d) => d.carbs))) * 4;
  const fatKcal = (day.fat - mean(week.days.map((d) => d.fat))) * 9;
  const fatMoved = Math.abs(fatKcal) > Math.abs(carbsKcal);
  const shift = fatMoved ? fatKcal : carbsKcal;
  if (!(Math.abs(shift) >= SAME_KCAL)) return null;

  const past = when === "past";
  const verb = fatMoved ? (past ? "was" : "is") : past ? "were" : "are";
  const macro = fatMoved ? "Fat" : "Carbs";
  const direction = shift > 0 ? "higher" : "lower";
  const session = SESSION[training.dayClass];
  const start = parseClock(training.day.time);
  return start !== null
    ? `${macro} ${verb} ${direction} ${dayPhrase} — ${session} at ${formatClock(start)}`
    : `${macro} ${verb} ${direction} ${dayPhrase} for the ${session}`;
}
