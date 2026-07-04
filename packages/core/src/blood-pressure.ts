/** Blood-pressure classification per the 2017 ACC/AHA guideline, plus a
 *  `low` band for hypotension (systolic < 90 or diastolic < 60) so a health
 *  tracker can flag it rather than fold it into "normal".
 *
 *  Either number can push a reading into a higher band ("or" logic), and the
 *  more severe band always wins — so 135/75 is Stage 1 (systolic), 125/85 is
 *  Stage 1 (diastolic), and 185/70 is a crisis. Pure; tested in
 *  `./blood-pressure.test.ts`. */
export type BloodPressureCategory =
  "low" | "normal" | "elevated" | "stage1" | "stage2" | "crisis";

export function bloodPressureCategory(
  systolic: number,
  diastolic: number,
): BloodPressureCategory {
  // High-side staging first, most-severe down — either number qualifies.
  if (systolic > 180 || diastolic > 120) return "crisis";
  if (systolic >= 140 || diastolic >= 90) return "stage2";
  if (systolic >= 130 || diastolic >= 80) return "stage1";
  // Elevated is systolic-only; diastolic is guaranteed < 80 here (else Stage 1).
  if (systolic >= 120) return "elevated";
  // Nothing high triggered — flag a genuinely low reading, else normal.
  if (systolic < 90 || diastolic < 60) return "low";
  return "normal";
}

/** Short human label for each category. */
export const BLOOD_PRESSURE_LABELS: Record<BloodPressureCategory, string> = {
  low: "Low",
  normal: "Normal",
  elevated: "Elevated",
  stage1: "Stage 1",
  stage2: "Stage 2",
  crisis: "Crisis",
};
