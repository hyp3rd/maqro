import type { PersonalInfo } from "./types";

/** Age derivation. When a profile carries a `birthDate`, age is computed from
 *  it (so it stays current automatically and the calorie target shifts
 *  silently on a birthday); otherwise the stored `age` is used. Pure +
 *  time-travel-safe via the optional `now`. */

/** Whole years from `birthDate` (`YYYY-MM-DD`) to `now`, or `null` when the
 *  date is missing / unparseable / in the future. Counts a birthday as
 *  completed only once it has passed in the current year (the conventional
 *  "how old are you" rule). */
export function ageFromBirthDate(
  birthDate: string | undefined | null,
  now: number = Date.now(),
): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date(now);
  let age = today.getFullYear() - y;
  // Subtract a year if this year's birthday hasn't happened yet.
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

/** The age to use for a profile: birthDate-derived when available, else the
 *  stored `age`. */
export function effectiveAge(
  profile: PersonalInfo,
  now: number = Date.now(),
): number {
  return ageFromBirthDate(profile.birthDate, now) ?? profile.age;
}
