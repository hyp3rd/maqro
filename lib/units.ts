/** Unit conversions + display formatters.
 *
 *  Architectural rule: **storage is always metric** (kg / cm).
 *  Conversions happen at the UI boundary only — `lib/macros.ts`,
 *  `body-fat.ts`, `trends.ts`, and every persisted row all stay
 *  in kg and cm regardless of what the user prefers. This means
 *  syncing a profile across devices doesn't lose precision, AI
 *  prompts can be written in one unit system, and switching the
 *  preference is a pure presentation change with no migration.
 *
 *  Why kg / lb only (no stones): three-way toggles need a special-
 *  case formatter for stones (it renders as `12 st 4 lb`, not a
 *  single number) and the international audience that asked for
 *  imperial overwhelmingly meant US-style pounds. Stones can land
 *  later as an opt-in if anyone asks. */

export type UnitSystem = "metric" | "imperial";

// ── Conversion factors ────────────────────────────────────────────
//
// Hard-coded once here so a typo in a formula in some random
// component can't quietly drift. The factors are exact / standard
// definitions; we round at the display layer, never during the
// math.

const KG_PER_LB = 0.45359237; // International avoirdupois pound.
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

// ── Weight ────────────────────────────────────────────────────────

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

// ── Height ────────────────────────────────────────────────────────

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** Split a cm height into whole feet + remaining inches. The
 *  input forms a single source of truth; rounding to the nearest
 *  half-inch on the way out matches how people read heights
 *  (5'11"), not how a doctor records them. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cmToInches(cm);
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = Math.round(totalInches - feet * INCHES_PER_FOOT);
  // Edge case: rounding 11.6" up to 12" should roll over.
  if (inches === INCHES_PER_FOOT) return { feet: feet + 1, inches: 0 };
  return { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * INCHES_PER_FOOT + inches);
}

// ── Display formatters ────────────────────────────────────────────
//
// Always take the metric (kg / cm) source value + the chosen
// system. Callers never need an `if (system === 'metric')` branch
// at the call site.

/** Format a weight (stored in kg) for the chosen system. One
 *  decimal place — matches how scales display, granular enough for
 *  weight tracking without false precision (a scale reading
 *  fluctuates more than 0.1 kg between consecutive steps). */
export function formatWeight(kg: number, system: UnitSystem): string {
  if (system === "imperial") {
    return `${kgToLb(kg).toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

/** Format a weight DELTA (e.g. "0.5 kg/week"). The number gets a
 *  sign so positive deltas render as `+0.3 lb/week`. */
export function formatWeightRate(
  kgPerWeek: number,
  system: UnitSystem,
): string {
  const value = system === "imperial" ? kgToLb(kgPerWeek) : kgPerWeek;
  const unit = system === "imperial" ? "lb" : "kg";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} ${unit}/week`;
}

/** Format a height (stored in cm) for the chosen system. Imperial
 *  renders as `5'11"` — the canonical US shorthand. Metric stays
 *  whole-cm because nobody enters their height to half-centimeter
 *  precision. */
export function formatHeight(cm: number, system: UnitSystem): string {
  if (system === "imperial") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}

// ── Display-precision helpers for input fields ────────────────────
//
// When showing the stored kg in an imperial input, we want a
// stable display value the user can edit cleanly. Truncating to
// 1 dp on lb and back stays within < 0.05 kg round-trip — fine
// for weight tracking, invisible to the user.

/** Convert kg → display number in the chosen system, rounded to
 *  one decimal place. Use this when seeding an `<input>` from
 *  stored kg. */
export function kgToDisplay(kg: number, system: UnitSystem): number {
  if (system === "imperial") return Math.round(kgToLb(kg) * 10) / 10;
  return Math.round(kg * 10) / 10;
}

/** Inverse of `kgToDisplay`: take the user's typed value and the
 *  active system, return kg for storage. */
export function displayToKg(value: number, system: UnitSystem): number {
  if (system === "imperial") return lbToKg(value);
  return value;
}

/** Convert cm → whole-number display value (`cm` in metric,
 *  `inches` in imperial). Imperial height usually shows as
 *  feet+inches via `cmToFeetInches`; this helper exists for
 *  metric-style single-field inputs where the imperial mode
 *  shows total inches. */
export function cmToDisplay(cm: number, system: UnitSystem): number {
  if (system === "imperial") return Math.round(cmToInches(cm));
  return Math.round(cm);
}

export function displayToCm(value: number, system: UnitSystem): number {
  if (system === "imperial") return inchesToCm(value);
  return value;
}

// ── Locale auto-detection ─────────────────────────────────────────

/** Browser locales that overwhelmingly use imperial in everyday
 *  weight / height usage. Per the
 *  [International System of Units adoption status](https://en.wikipedia.org/wiki/Metrication_in_the_United_States):
 *  the US, Liberia, and Myanmar are the three holdout countries.
 *  Everyone else (including the UK, which uses metric officially
 *  but mixes lb / st casually) gets metric as the safer default —
 *  the toggle in Settings is one tap away. */
const IMPERIAL_LOCALE_PREFIXES = ["en-us", "en-lr", "en-mm"];

/** Best-effort guess at the right default system from the browser's
 *  reported locale. Returns `"metric"` when run server-side (no
 *  `navigator`) or when nothing in the user's language list looks
 *  imperial. Callers should only use this on first load — once a
 *  user has explicitly set their preference, store it in the
 *  profile and stop guessing. */
export function detectDefaultUnitSystem(): UnitSystem {
  if (typeof navigator === "undefined") return "metric";
  const languages =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  for (const raw of languages) {
    const lower = raw.toLowerCase();
    if (IMPERIAL_LOCALE_PREFIXES.some((p) => lower.startsWith(p))) {
      return "imperial";
    }
  }
  return "metric";
}

/** Suffix shown next to weight / weekly-rate input fields. */
export function weightUnitSuffix(system: UnitSystem): string {
  return system === "imperial" ? "lb" : "kg";
}

/** Suffix shown next to height input fields. Imperial returns
 *  `"in"` since feet+inches is rendered as a two-input pair, not
 *  a single field with a suffix. */
export function heightUnitSuffix(system: UnitSystem): string {
  return system === "imperial" ? "in" : "cm";
}
