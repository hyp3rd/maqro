/** US Navy / Hodgdon–Beckett body-fat estimator (metric form).
 *
 *  The Navy formula's published `86.010 × log10(waist − neck)…`
 *  coefficients are calibrated for **inches**. The metric derivation
 *  uses Hodgdon–Beckett body density first, then Siri's equation:
 *
 *    BF% = 495 / Db − 450
 *
 *  where Db (g/cm³) is:
 *
 *    Male:   Db = 1.0324 − 0.19077 × log10(waist − neck) + 0.15456 × log10(height)
 *    Female: Db = 1.29579 − 0.35004 × log10(waist + hip − neck) + 0.22100 × log10(height)
 *
 *  Measurements in centimeters, logs base 10. Accuracy ≈ ±3% vs DEXA
 *  for adults inside a normal BMI range. The app records `gender` as
 *  `male | female | nonbinary | preferNotToSay` — for the latter two
 *  we don't pick a formula automatically (there isn't a published
 *  Navy formula for non-binary bodies), and the caller is expected to
 *  ask the user which body-type estimate they want, or skip it.
 *
 *  Inputs that don't satisfy the formula's domain (waist − neck ≤ 0
 *  for male, log of non-positive, missing hip for female) return
 *  null. Out-of-range outputs (< 3% or > 60% — outside published
 *  human limits) also return null, since they almost always indicate
 *  a measurement error rather than a real value.
 *
 *  Everything in this module is pure; tests live in `./body-fat.test.ts`. */

export type BodyFatInputs = {
  /** Body-type to apply the formula for. `nonbinary` and `prefer-not`
   *  return null — the caller should prompt the user to pick. */
  bodyType: "male" | "female";
  /** Height in cm. */
  heightCm: number;
  /** Waist circumference in cm (narrowest point, typically navel level). */
  waistCm: number;
  /** Neck circumference in cm. */
  neckCm: number;
  /** Hip circumference in cm. Required for `female`; ignored for `male`. */
  hipCm?: number;
};

/** Returns an estimated body-fat percentage rounded to one decimal,
 *  or null when inputs are missing / out of formula domain / produce
 *  an implausible result. */
export function estimateBodyFat(input: BodyFatInputs): number | null {
  const { bodyType, heightCm, waistCm, neckCm, hipCm } = input;
  if (!isPositive(heightCm) || !isPositive(waistCm) || !isPositive(neckCm)) {
    return null;
  }
  let density: number;
  if (bodyType === "male") {
    const diff = waistCm - neckCm;
    if (diff <= 0) return null;
    density =
      1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(heightCm);
  } else {
    if (!isPositive(hipCm)) return null;
    const sum = waistCm + (hipCm as number) - neckCm;
    if (sum <= 0) return null;
    density =
      1.29579 - 0.35004 * Math.log10(sum) + 0.221 * Math.log10(heightCm);
  }
  // Siri equation. Density values outside the human range
  // (~0.95–1.10) produce nonsense BF; we filter at the output.
  const bf = 495 / density - 450;
  if (!Number.isFinite(bf) || bf < 3 || bf > 60) return null;
  return Math.round(bf * 10) / 10;
}

/** Returns a coarse categorical reading of a body-fat estimate
 *  ("essential" / "athletic" / "fitness" / "average" / "obese")
 *  using the ACE chart, gendered. Used by the Progress card to give
 *  the number context — "23.4%" alone is hard to interpret. */
export function bodyFatCategory(
  bf: number,
  bodyType: "male" | "female",
): "essential" | "athletic" | "fitness" | "average" | "obese" {
  if (bodyType === "male") {
    if (bf < 6) return "essential";
    if (bf < 14) return "athletic";
    if (bf < 18) return "fitness";
    if (bf < 25) return "average";
    return "obese";
  }
  if (bf < 14) return "essential";
  if (bf < 21) return "athletic";
  if (bf < 25) return "fitness";
  if (bf < 32) return "average";
  return "obese";
}

function isPositive(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}
