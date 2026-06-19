import type { PersonalInfo } from "./types";

/** Domain logic for hydration tracking. Kept separate from `lib/units.ts`
 *  (which stays purely about ml↔fl-oz conversion) so the goal formula and
 *  the quick-add increments live with the rest of the app's calculation
 *  layer, the way `lib/macros.ts` / `lib/body-fat.ts` own their math. */

/** Quick-add increments (millilitres) — a glass and a bottle. */
export const GLASS_ML = 250;
export const BOTTLE_ML = 500;

/** Millilitres of water per kg of bodyweight for the default goal. ~35 ml/kg
 *  is the common rule of thumb (a 70 kg person → ~2.45 L). It's a starting
 *  point, not a medical prescription — hence the manual override. */
const ML_PER_KG = 35;

/** Floor / ceiling on the derived goal so an extreme bodyweight can't produce
 *  an unreasonable target. */
const MIN_GOAL_ML = 1500;
const MAX_GOAL_ML = 4000;

/** The effective daily water goal in millilitres. Uses the user's manual
 *  override when set (and positive); otherwise derives it from bodyweight,
 *  clamped to a sane range. Rounded to the nearest 50 ml so the displayed
 *  target is tidy. */
export function waterGoalMl(profile: PersonalInfo): number {
  const override = profile.waterGoalMl;
  if (typeof override === "number" && override > 0) {
    return Math.round(override);
  }
  const derived = profile.weight * ML_PER_KG;
  const clamped = Math.min(MAX_GOAL_ML, Math.max(MIN_GOAL_ML, derived));
  return Math.round(clamped / 50) * 50;
}
