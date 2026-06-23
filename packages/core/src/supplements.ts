import type { MicronutrientKey, MicronutrientValues } from "./rda";
import type {
  Supplement,
  SupplementIntake,
  SupplementSchedule,
} from "./records";

/** Pure supplement logic — the micronutrient feed + the reminder-schedule match.
 *  No React, no I/O: the caller supplies the library lookup, so this stays
 *  trivially testable and shared with the native app. */

/** Sum the ABSOLUTE micronutrient amounts a day's taken supplements provide:
 *  for each `{ supplementId, doses }`, add `supplement.micros × doses`. Supplement
 *  amounts are absolute per dose (not per-100g), so there's no portion scaling.
 *  Unknown ids and non-positive doses are skipped; an empty result is `{}` (the
 *  aggregator's omit-unseen contract handles partial coverage). */
export function supplementMicrosForDay(
  intake: SupplementIntake | undefined,
  supplementsById: Map<string, Supplement>,
): MicronutrientValues {
  const out: MicronutrientValues = {};
  if (!intake) return out;
  for (const entry of intake.taken) {
    if (!(entry.doses > 0)) continue;
    const supp = supplementsById.get(entry.supplementId);
    if (!supp) continue;
    for (const key of Object.keys(supp.micros) as MicronutrientKey[]) {
      const v = supp.micros[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[key] = (out[key] ?? 0) + v * entry.doses;
      }
    }
  }
  return out;
}

/** Whether a supplement's reminder schedule fires at local `hour` (0–23) on
 *  local `dayOfWeek` (0=Sun … 6=Sat). False for no schedule / empty arrays. */
export function scheduleFiresAt(
  schedule: SupplementSchedule | undefined,
  hour: number,
  dayOfWeek: number,
): boolean {
  if (!schedule) return false;
  return (
    schedule.reminderTimes.includes(hour) &&
    schedule.daysOfWeek.includes(dayOfWeek)
  );
}

/** Build the id→supplement lookup the micro feed needs from a flat list. */
export function supplementsById(
  supplements: Supplement[],
): Map<string, Supplement> {
  return new Map(supplements.map((s) => [s.id, s]));
}
