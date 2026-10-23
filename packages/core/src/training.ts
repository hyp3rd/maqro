import type {
  CyclingPreset,
  PersonalInfo,
  ProteinSetting,
  TrainingDay,
  TrainingIntensity,
  TrainingSchedule,
  TrainingType,
  TrainingWeek,
} from "./types";

/** Pure training-day engine: read-time validation of the optional training
 *  template + protein setting, the session → day-class table, the planned
 *  per-day calorie distribution around the weekly average, and the per-day
 *  macro partition. `targetsForDate` (targets.ts) composes these; nothing
 *  here reads a clock, storage or the environment.
 *
 *  Product rules this module encodes (docs/changelog.md, "Considered,
 *  deliberately not pursuing"): no calorie banking and no reactive weekly
 *  rebalancing — the per-day targets are PLANNED from the template, their
 *  weekly sum is the goal's 7 × daily average, and exercise calories are
 *  never added on top (adaptive TDEE already includes average training). */

export const TRAINING_TYPES: readonly TrainingType[] = [
  "rest",
  "upper",
  "lower",
  "fullBody",
  "endurance",
  "hiit",
  "sport",
];

export const TRAINING_INTENSITIES: readonly TrainingIntensity[] = [
  "light",
  "moderate",
  "hard",
];

export const CYCLING_PRESETS: readonly CyclingPreset[] = [
  "off",
  "modest",
  "pronounced",
];

/** Cycling preset used when the stored one is missing or unknown. */
export const DEFAULT_CYCLING: CyclingPreset = "modest";

/** What a day's session means for its calories. */
export type TrainingDayClass =
  "rest" | "light" | "training" | "heavy" | "endurance";

/** An endurance session longer than this (minutes) is "long endurance". */
export const LONG_ENDURANCE_MIN = 60;

/** Relative day weights per preset, normalized to the template week's mean
 *  before use (so only their ratios matter). Modest is the default;
 *  Pronounced is opt-in. Sources: MacroFactor / Leangains practice, RP
 *  per-weekday templates (scratchpad evidence A4). */
export const CYCLING_WEIGHTS: Record<
  Exclude<CyclingPreset, "off">,
  Record<TrainingDayClass, number>
> = {
  modest: {
    rest: 0.9,
    light: 1.0,
    training: 1.05,
    heavy: 1.15,
    endurance: 1.1,
  },
  pronounced: {
    rest: 0.8,
    light: 1.05,
    training: 1.1,
    heavy: 1.25,
    endurance: 1.2,
  },
};

/** Day bounds relative to the weekly mean: never below 80%, never above
 *  125% (and never below the safety floor — see `distributeWeekCalories`). */
export const DAY_MIN_OF_MEAN = 0.8;
export const DAY_MAX_OF_MEAN = 1.25;
/** No generated day goes under this, whatever floor the caller passes
 *  (very-low-calorie diet territory: AHA/ACC/TOS 2013, NICE NG246). */
export const ABSOLUTE_MIN_DAY_KCAL = 800;
/** Cycled day targets are planned in steps of this many kcal. */
export const DAY_KCAL_STEP = 50;
/** Training-day macros are planned in steps of this many grams. */
export const MACRO_GRAM_STEP = 5;

export const DEFAULT_PROTEIN_SETTING: ProteinSetting = {
  basis: "bodyweight",
  gPerKg: 2.0,
};
/** Safe g/kg range: 1.2 is the any-goal floor (DGA 2025–2030); the opt-in
 *  ceiling is 3.1 g/kg lean mass ≈ 3.4 g/kg bodyweight (ISSN 2017). */
export const PROTEIN_G_PER_KG_MIN = 1.2;
export const PROTEIN_G_PER_KG_MAX: Record<ProteinSetting["basis"], number> = {
  bodyweight: 3.4,
  leanMass: 3.1,
};
/** A body-fat estimate outside this range is treated as absent — the same
 *  plausibility window `estimateBodyFat` applies. */
const BODY_FAT_MIN_PCT = 3;
const BODY_FAT_MAX_PCT = 60;

const MAX_DURATION_MIN = 24 * 60;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ISO weekday order (Mon → Sun) as `getDay()` indices — the tie-break order
 *  for the rounding remainder, so equal days are resolved Monday-first. */
const ISO_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === "string" && (options as readonly string[]).includes(v);
}

function normalizeTrainingDay(raw: unknown): TrainingDay {
  if (!isRecord(raw) || !isOneOf(raw.type, TRAINING_TYPES)) {
    return { type: "rest" };
  }
  const day: TrainingDay = { type: raw.type };
  if (isOneOf(raw.intensity, TRAINING_INTENSITIES)) {
    day.intensity = raw.intensity;
  }
  if (typeof raw.time === "string" && HH_MM.test(raw.time)) {
    day.time = raw.time;
  }
  const d = raw.durationMin;
  if (
    typeof d === "number" &&
    Number.isFinite(d) &&
    d > 0 &&
    d <= MAX_DURATION_MIN
  ) {
    day.durationMin = d;
  }
  return day;
}

/** Validate the profile's `training` payload at read time. `profiles.payload`
 *  is jsonb that nothing validates on write (any client version may have
 *  written it), so this never trusts its shape. Returns a fresh object: the
 *  payload is never mutated, and callers must not persist the result back
 *  (load-time normalization would rewrite another client's data).
 *
 *  - Not an object, or `days` not exactly 7 entries → `null` (no usable
 *    template: targets stay exactly as without training).
 *  - `enabled` is on only for a literal `true`.
 *  - An unknown `cycling` → the `modest` default.
 *  - A malformed day → rest; malformed optional fields (`intensity`, a
 *    non-`HH:MM` `time`, a non-positive / over-24 h `durationMin`) are dropped;
 *    unknown keys are stripped. */
export function normalizeTrainingSchedule(
  raw: unknown,
): TrainingSchedule | null {
  if (!isRecord(raw)) return null;
  const days = raw.days;
  if (!Array.isArray(days) || days.length !== 7) return null;
  return {
    enabled: raw.enabled === true,
    days: [
      normalizeTrainingDay(days[0]),
      normalizeTrainingDay(days[1]),
      normalizeTrainingDay(days[2]),
      normalizeTrainingDay(days[3]),
      normalizeTrainingDay(days[4]),
      normalizeTrainingDay(days[5]),
      normalizeTrainingDay(days[6]),
    ] satisfies TrainingWeek,
    cycling: isOneOf(raw.cycling, CYCLING_PRESETS)
      ? raw.cycling
      : DEFAULT_CYCLING,
  };
}

/** Validate the profile's `proteinSetting` at read time (same rules as
 *  `normalizeTrainingSchedule`: fresh object, never persisted). Missing or
 *  malformed parts take the default (2.0 g/kg bodyweight); a finite g/kg is
 *  clamped into [1.2, 3.4] (bodyweight) or [1.2, 3.1] (lean mass). */
export function normalizeProteinSetting(raw: unknown): ProteinSetting {
  if (!isRecord(raw)) return { ...DEFAULT_PROTEIN_SETTING };
  const basis = isOneOf(raw.basis, ["bodyweight", "leanMass"] as const)
    ? raw.basis
    : DEFAULT_PROTEIN_SETTING.basis;
  const g = raw.gPerKg;
  const gPerKg =
    typeof g === "number" && Number.isFinite(g)
      ? Math.min(PROTEIN_G_PER_KG_MAX[basis], Math.max(PROTEIN_G_PER_KG_MIN, g))
      : DEFAULT_PROTEIN_SETTING.gPerKg;
  return { basis, gPerKg };
}

/** The session → day-class table. First matching row wins:
 *
 *  | # | session                                   | class       |
 *  |---|-------------------------------------------|-------------|
 *  | 1 | type `rest` (any intensity)               | `rest`      |
 *  | 2 | intensity `light` (any type)              | `light`     |
 *  | 3 | `endurance` longer than 60 min            | `endurance` |
 *  | 4 | intensity `hard` (any type)               | `heavy`     |
 *  | 5 | `lower` with no intensity ("leg day")     | `heavy`     |
 *  | 6 | everything else (moderate / unspecified)  | `training`  |
 *
 *  Only endurance uses the duration (A2: "optional long endurance
 *  (>60 min)"); a long hard endurance session is `endurance`, a short hard
 *  one `heavy`. */
export function classifyTrainingDay(day: TrainingDay): TrainingDayClass {
  if (day.type === "rest") return "rest";
  if (day.intensity === "light") return "light";
  if (
    day.type === "endurance" &&
    day.durationMin !== undefined &&
    day.durationMin > LONG_ENDURANCE_MIN
  ) {
    return "endurance";
  }
  if (day.intensity === "hard") return "heavy";
  if (day.type === "lower" && day.intensity === undefined) return "heavy";
  return "training";
}

export type WeekCaloriesInput = {
  /** The weekly mean daily target T (kcal) — `computeMacros`' result. */
  meanKcal: number;
  /** The seven day classes, indexed by `getDay()` (0 = Sunday). */
  classes: readonly TrainingDayClass[];
  cycling: CyclingPreset;
  /** The per-day safety floor (`max(BMR, 1200)`). */
  floorKcal: number;
};

const ceilStep = (x: number, step: number) => Math.ceil(x / step) * step;
const floorStep = (x: number, step: number) => Math.floor(x / step) * step;
const roundStep = (x: number, step: number) => Math.round(x / step) * step;
/** Strip float noise (e.g. 1999.9999999998) before step arithmetic. */
const clean = (x: number) => Math.round(x * 1e6) / 1e6;

/** Planned calories for each template day (indexed by `getDay()`), around the
 *  weekly mean T:
 *
 *  1. `off`, or a template whose days all weigh the same → every day is T.
 *  2. Raw day = T × w_d / mean(w) — the week sums to exactly 7T.
 *  3. Bounds: lo = max(floor, 0.80T, 800), hi = 1.25T, taken inward to the
 *     50 kcal grid. If they leave T no room (lo > T, e.g. T sits on the
 *     floor) → every day is T: the floor is never lowered to make a spread.
 *  4. Narrowing: when a raw day falls outside the bounds, the WHOLE spread
 *     is scaled down — day_i = T + α(raw_i − T), the largest α ≤ 1 that
 *     fits — so the sum stays 7T and the days keep their order and
 *     proportions.
 *  5. Rounding to 50 kcal by largest remainder (ties Monday-first).
 *
 *  Guarantee (when a spread exists): every day is a multiple of 50 within
 *  the bounds, and the week's sum is within 25 kcal of 7T — exactly 7T
 *  whenever 7T is itself a multiple of 50. (Each day rounds to its 50-step
 *  floor; the n = round(remainder sum / 50) largest remainders round up.
 *  Every remainder is < 50, so n never exceeds the days that have one, and
 *  |remainder sum − 50n| ≤ 25.) */
export function distributeWeekCalories(input: WeekCaloriesInput): number[] {
  const { meanKcal: mean, classes, cycling } = input;
  const flat = () => classes.map(() => mean);
  if (cycling === "off") return flat();

  const table = CYCLING_WEIGHTS[cycling];
  const weights = classes.map((c) => table[c]);
  if (weights.every((w) => w === weights[0])) return flat();
  const meanWeight = weights.reduce((s, w) => s + w, 0) / weights.length;
  const raw = weights.map((w) => (mean * w) / meanWeight);

  const lo = ceilStep(
    Math.max(input.floorKcal, DAY_MIN_OF_MEAN * mean, ABSOLUTE_MIN_DAY_KCAL),
    DAY_KCAL_STEP,
  );
  const hi = floorStep(DAY_MAX_OF_MEAN * mean, DAY_KCAL_STEP);
  if (lo > mean || hi < mean) return flat();

  let alpha = 1;
  for (const r of raw) {
    if (r < mean) alpha = Math.min(alpha, (mean - lo) / (mean - r));
    else if (r > mean) alpha = Math.min(alpha, (hi - mean) / (r - mean));
  }
  if (alpha <= 0) return flat();
  const spread = raw.map((r) => clean(mean + alpha * (r - mean)));

  const out = spread.map((x) => floorStep(x, DAY_KCAL_STEP));
  const remainders = spread.map((x, i) => x - out[i]);
  const units = Math.round(
    remainders.reduce((s, r) => s + r, 0) / DAY_KCAL_STEP,
  );
  const order = ISO_ORDER.filter((i) => i < classes.length).sort(
    (a, b) => remainders[b] - remainders[a],
  );
  for (const i of order.slice(0, units)) out[i] += DAY_KCAL_STEP;
  return out;
}

/** Daily protein grams for the setting: g/kg × bodyweight, or × lean mass
 *  (weight × (1 − body fat %)) when the basis is `leanMass` AND a plausible
 *  body-fat estimate (3–60 %) is supplied. Without one, lean mass falls back
 *  to bodyweight; `basis` reports which one was actually used. */
export function proteinGrams(
  setting: ProteinSetting,
  weightKg: number,
  bodyFatPct?: number | null,
): { grams: number; basis: ProteinSetting["basis"] } {
  if (
    setting.basis === "leanMass" &&
    typeof bodyFatPct === "number" &&
    Number.isFinite(bodyFatPct) &&
    bodyFatPct >= BODY_FAT_MIN_PCT &&
    bodyFatPct <= BODY_FAT_MAX_PCT
  ) {
    return {
      grams: setting.gPerKg * weightKg * (1 - bodyFatPct / 100),
      basis: "leanMass",
    };
  }
  return { grams: setting.gPerKg * weightKg, basis: "bodyweight" };
}

/** Diets where FAT absorbs the day-to-day difference and carbs hold (low-carb,
 *  and any keto variant should one be added to `dietType`). */
export function fatMovesForDiet(dietType: PersonalInfo["dietType"]): boolean {
  return dietType === "lowCarb";
}

export type DayMacroInput = {
  /** The day's planned calories. */
  dayKcal: number;
  dayClass: TrainingDayClass;
  /** The weekly mean day from `computeMacros` (its split, or the user's
   *  `macroSplit` override, applied to T): sets the held macro's level. */
  mean: { targetCalories: number; carbs: number; fat: number };
  /** Fixed daily protein (unrounded) — from `proteinGrams`. */
  proteinGrams: number;
  weightKg: number;
  /** The goal driving the target (a cut allows the 15% fat floor). */
  goal: PersonalInfo["goal"];
  dietType: PersonalInfo["dietType"];
};

/** Split a training day's calories into macros (A5/A6):
 *
 *  - Protein: the same grams every day.
 *  - Fat floor: max(0.5 g/kg, 20% of the MEAN kcal — 15% in a cut).
 *  - Default (carbs move): fat holds at the mean day's level (at least the
 *    floor) and carbs take the rest. Rest days keep ≥ 1 g/kg carbs and heavy
 *    days aim for ≥ 3 g/kg by trading fat down — never below its floor —
 *    when the day's budget allows.
 *  - Low-carb (fat moves): carbs hold at the mean day's level and fat takes
 *    the rest; if that would put fat under its floor, carbs give way.
 *  - Everything is in 5 g steps; the moving macro is derived last from the
 *    rounded others, so 4P + 4C + 9F is within one 5 g step of the moving
 *    macro (≤ 20 kcal for carbs, ≤ 45 kcal for fat) of `dayKcal`.
 *  - A day that can't hold protein + the fat floor (only reachable with an
 *    extreme g/kg on a small day): carbs 0, fat takes what's left; a day
 *    under the protein alone caps protein to the day. */
export function partitionDayMacros(input: DayMacroInput): {
  protein: number;
  carbs: number;
  fat: number;
} {
  const step = MACRO_GRAM_STEP;
  const K = input.dayKcal;
  const P = roundStep(input.proteinGrams, step);
  const fatFloor = Math.max(
    0.5 * input.weightKg,
    ((input.goal === "lose" ? 0.15 : 0.2) * input.mean.targetCalories) / 9,
  );
  const fatFloorStep = ceilStep(fatFloor, step);
  const afterProtein = K - 4 * P;

  const exhausted = () => {
    if (afterProtein < 0) {
      return { protein: floorStep(K / 4, step), carbs: 0, fat: 0 };
    }
    return { protein: P, carbs: 0, fat: floorStep(afterProtein / 9, step) };
  };
  if (afterProtein < 9 * fatFloorStep) return exhausted();

  if (fatMovesForDiet(input.dietType)) {
    let C = roundStep(Math.max(0, input.mean.carbs), step);
    if ((afterProtein - 4 * C) / 9 < fatFloor) {
      C = floorStep(Math.max(0, (afterProtein - 9 * fatFloorStep) / 4), step);
    }
    let F = roundStep((afterProtein - 4 * C) / 9, step);
    if (F < fatFloor) F += step;
    return { protein: P, carbs: C, fat: F };
  }

  const carbMinPerKg =
    input.dayClass === "rest" ? 1 : input.dayClass === "heavy" ? 3 : 0;
  const carbMin = carbMinPerKg * input.weightKg;
  const held = Math.max(input.mean.fat, fatFloor);
  let F = Math.max(roundStep(held, step), fatFloorStep);
  if ((afterProtein - 9 * F) / 4 < carbMin) {
    // Make room for the carb minimum from fat, down to (never past) its floor.
    const room = (afterProtein - 4 * carbMin) / 9;
    F = Math.min(F, Math.max(fatFloorStep, floorStep(room, step)));
  }
  const C = roundStep(Math.max(0, (afterProtein - 9 * F) / 4), step);
  return { protein: P, carbs: C, fat: F };
}
