import { customSplitRatios } from "./macros";
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
/** A session longer than this (minutes) is never a `light` day. */
export const NEVER_LIGHT_OVER_MIN = 90;

/** Relative day weights per preset, normalized to the template week's mean
 *  before use (so only their ratios matter). Modest is the default;
 *  Pronounced is opt-in. Practice-based, not trial-based: MacroFactor's
 *  coached calorie shifts ("modest by default"), Leangains / RippedBody
 *  training- vs rest-day targets, and RP Diet Coach's per-weekday templates
 *  (its "Diet Setup" docs). A long endurance day counts at least as heavy
 *  (owner decision), so it weighs the same as `heavy`; it stays a class of
 *  its own so the day can be told apart from a heavy lifting day. */
export const CYCLING_WEIGHTS: Record<
  Exclude<CyclingPreset, "off">,
  Record<TrainingDayClass, number>
> = {
  modest: {
    rest: 0.9,
    light: 1.0,
    training: 1.05,
    heavy: 1.15,
    endurance: 1.15,
  },
  pronounced: {
    rest: 0.8,
    light: 1.05,
    training: 1.1,
    heavy: 1.25,
    endurance: 1.25,
  },
};

/** Day bounds relative to the weekly mean: never below 80%, never above
 *  125% (and never below the per-day floor — see `distributeWeekCalories`). */
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
 *  | # | session                                        | class       |
 *  |---|------------------------------------------------|-------------|
 *  | 1 | type `rest` (any intensity or duration)        | `rest`      |
 *  | 2 | `endurance` longer than 60 min (any intensity) | `endurance` |
 *  | 3 | intensity `light`, up to 90 min                | `light`     |
 *  | 4 | intensity `hard` (any type)                    | `heavy`     |
 *  | 5 | `lower` with no intensity ("leg day")          | `heavy`     |
 *  | 6 | everything else (moderate / unspecified, and   | `training`  |
 *  |   | a `light` session longer than 90 min)          |             |
 *
 *  Duration-aware (owner decision): an endurance session over 60 min counts
 *  at least as heavy (`endurance` weighs the same as `heavy`), whatever its
 *  intensity — over 60 min is where the carbohydrate guidance changes
 *  (Thomas et al. 2016, the joint sports-nutrition position stand); any
 *  session over 90 min is never `light` (at least `training`); a shorter
 *  session, or one with no duration, keeps its intensity-based class. */
export function classifyTrainingDay(day: TrainingDay): TrainingDayClass {
  if (day.type === "rest") return "rest";
  const minutes = day.durationMin ?? 0;
  if (day.type === "endurance" && minutes > LONG_ENDURANCE_MIN) {
    return "endurance";
  }
  if (day.intensity === "light" && minutes <= NEVER_LIGHT_OVER_MIN) {
    return "light";
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
  /** The per-day floor no planned day may go under: the safety floor
   *  (`max(BMR, 1200)`) and, from `targetsForDate`, the macro floors'
   *  `minDayKcal`. */
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

/** At or above this BMI, with no body-fat estimate, protein g/kg is taken on
 *  the reference weight instead of total bodyweight. */
export const OBESE_BMI = 30;
/** The BMI the reference weight is taken at. */
export const REFERENCE_BMI = 25;

/** The weight (kg) at BMI 25 for a height in cm (180 cm → 81 kg), or
 *  `null` for a height that isn't a positive number. */
export function referenceWeightKg(heightCm: number): number | null {
  if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
  return REFERENCE_BMI * (heightCm / 100) ** 2;
}

/** The body measure protein g/kg was actually applied to. */
export type ProteinBasis = ProteinSetting["basis"] | "referenceWeight";

/** What `proteinGrams` reads about the body. */
export type ProteinBody = {
  weightKg: number;
  heightCm: number;
  /** The latest body-fat estimate (%), if any. */
  bodyFatPct?: number | null;
};

/** Daily protein grams for the setting, and the kg its g/kg was applied to:
 *
 *  - `leanMass` setting with a plausible body-fat estimate (3–60 %): g/kg ×
 *    lean mass (weight × (1 − body fat %)).
 *  - `leanMass` without one: the 2.0 g/kg default on bodyweight — not its
 *    own g/kg, which is a per-kg-of-FFM figure and would over-prescribe
 *    (owner decision).
 *  - `bodyweight`: its g/kg × bodyweight.
 *  - No body-fat estimate and BMI ≥ 30: the bodyweight figures above are
 *    taken on the reference weight at BMI 25 for the height instead (180 cm
 *    → 81 kg → 162 g at 2.0 g/kg), as total weight over-prescribes protein
 *    with more body fat (owner decision; Carbon and MacroFactor ask for a
 *    body-fat estimate there). With an estimate, the user's chosen basis
 *    applies as set.
 *
 *  `basis` is the one actually used, so the UI can suggest adding a body-fat
 *  estimate; `kg` is what the any-goal 1.2 g/kg minimum is taken on
 *  (bodyweight, or the reference weight — never lean mass, as that minimum
 *  is a bodyweight figure). */
export function proteinGrams(
  setting: ProteinSetting,
  body: ProteinBody,
): { grams: number; basis: ProteinBasis; kg: number } {
  const { weightKg, bodyFatPct } = body;
  const hasBodyFat =
    typeof bodyFatPct === "number" &&
    Number.isFinite(bodyFatPct) &&
    bodyFatPct >= BODY_FAT_MIN_PCT &&
    bodyFatPct <= BODY_FAT_MAX_PCT;
  if (hasBodyFat && setting.basis === "leanMass") {
    return {
      grams: setting.gPerKg * weightKg * (1 - bodyFatPct / 100),
      basis: "leanMass",
      kg: weightKg,
    };
  }
  const gPerKg =
    setting.basis === "leanMass"
      ? DEFAULT_PROTEIN_SETTING.gPerKg
      : setting.gPerKg;
  const reference = referenceWeightKg(body.heightCm);
  // BMI = weight / height² = REFERENCE_BMI × weight / reference.
  if (
    !hasBodyFat &&
    reference !== null &&
    clean((REFERENCE_BMI * weightKg) / reference) >= OBESE_BMI
  ) {
    return {
      grams: gPerKg * reference,
      basis: "referenceWeight",
      kg: reference,
    };
  }
  return { grams: gPerKg * weightKg, basis: "bodyweight", kg: weightKg };
}

/** Diets where FAT absorbs the day-to-day difference and carbs hold (low-carb,
 *  and any keto variant should one be added to `dietType`). */
export function fatMovesForDiet(dietType: PersonalInfo["dietType"]): boolean {
  return dietType === "lowCarb";
}

/** Every carb-moving day keeps at least this many g/kg of carbs
 *  (RippedBody's minimum; a low-carb diet has no carb floor). */
export const CARB_FLOOR_G_PER_KG = 1;

/** What sets a day's macro floors. */
export type MacroFloorInput = {
  /** Bodyweight: the fat (0.5 g/kg) and carb (1 g/kg) floors' basis. */
  weightKg: number;
  /** The kg the 1.2 g/kg protein minimum is taken on — `proteinGrams`' `kg`
   *  (bodyweight, or the BMI-25 reference weight). */
  proteinKg: number;
  /** The weekly mean daily target T (kcal): the fat floor's % basis. */
  meanKcal: number;
  /** The goal driving the target (a cut allows the 15% fat floor). */
  goal: PersonalInfo["goal"];
  dietType: PersonalInfo["dietType"];
  /** The user chose their fat level explicitly — the `lowFat` diet type or
   *  a custom macro split (`explicitFatChoice`): it holds down to the 15%
   *  hard floor. */
  explicitFatChoice: boolean;
};

/** Fat floor shares of the MEAN kcal: the default (the lower bound of the
 *  IOM's 20–35% acceptable range) and the hard floor (Helms 2014's 15% in contest prep; RP never
 *  goes below 15%), which a cut or an explicit low-fat choice may use. */
export const FAT_FLOOR_SHARE = 0.2;
export const FAT_HARD_FLOOR_SHARE = 0.15;
/** Every fat floor is also at least this many g/kg bodyweight (RippedBody;
 *  Iraki 2019). */
export const FAT_FLOOR_G_PER_KG = 0.5;

/** Whether the profile chose its fat level explicitly: the `lowFat` diet
 *  type, or a custom macro split in effect (`customSplitRatios`). */
export function explicitFatChoice(
  profile: Pick<PersonalInfo, "dietType" | "macroSplit">,
): boolean {
  return (
    profile.dietType === "lowFat" ||
    customSplitRatios(profile.macroSplit) !== null
  );
}

/** The fat floor (g, unrounded) while training (owner decision):
 *  max(0.5 g/kg, 20% of the MEAN kcal), or the 15% hard floor in a cut or
 *  for an explicit low-fat choice. Plans hold its 5 g step taken upward. */
export function fatFloorGrams(input: MacroFloorInput): number {
  const share =
    input.goal === "lose" || input.explicitFatChoice
      ? FAT_HARD_FLOOR_SHARE
      : FAT_FLOOR_SHARE;
  return Math.max(
    FAT_FLOOR_G_PER_KG * input.weightKg,
    (share * input.meanKcal) / 9,
  );
}

/** `computeMacros` rounds fat to whole grams, so the user's chosen level is
 *  only known to within this much. */
const FAT_ROUNDING_G = 0.5;

/** Whether the fat floor lifted the user's EXPLICIT fat choice — their
 *  `lowFat` diet or custom split asked for less fat than the floor
 *  (beyond `computeMacros`' whole-gram rounding), so the plan holds the
 *  floor instead (`training.fatFloorLifted`: the UI's info note). Never
 *  true for a default split: that isn't the user's choice. */
export function fatFloorLiftsChoice(
  input: MacroFloorInput & {
    /** The mean day's fat (g) from the user's split (`computeMacros`). */
    meanFat: number;
  },
): boolean {
  return (
    input.explicitFatChoice &&
    input.meanFat + FAT_ROUNDING_G < fatFloorGrams(input)
  );
}

/** The most protein (g, a 5 g step) a day of `dayKcal` can hold without
 *  breaking a macro floor: when they collide, the protein setting is what
 *  gives way. Precedence, highest first:
 *
 *  1. The fat floor — always held (RP's 15% hard floor; Helms 2014).
 *  2. Protein up to the lesser of the setting and 1.2 g/kg (the any-goal
 *     floor, DGA 2025–2030), on `proteinKg`.
 *  3. The 1 g/kg carb floor (carb-moving diets only).
 *  4. The rest of the protein setting.
 *
 *  0 when the day can't even hold the fat floor. */
export function proteinCeilingGrams(
  input: MacroFloorInput & {
    dayKcal: number;
    /** The protein the setting asks for (unrounded) — bounds rule 2. */
    proteinGrams: number;
  },
): number {
  const step = MACRO_GRAM_STEP;
  const afterFat = input.dayKcal - 9 * ceilStep(fatFloorGrams(input), step);
  const carbFloor = fatMovesForDiet(input.dietType)
    ? 0
    : ceilStep(CARB_FLOOR_G_PER_KG * input.weightKg, step);
  const withCarbFloor = floorStep((afterFat - 4 * carbFloor) / 4, step);
  const withFatFloorOnly = floorStep(afterFat / 4, step);
  const proteinFloor = Math.min(
    roundStep(input.proteinGrams, step),
    roundStep(PROTEIN_G_PER_KG_MIN * input.proteinKg, step),
  );
  return Math.max(0, withCarbFloor, Math.min(withFatFloorOnly, proteinFloor));
}

/** The smallest day (kcal) that holds the protein setting, the fat floor
 *  and the 1 g/kg carb floor (none on a fat-moving diet) together, on the
 *  5 g grid the partition uses: 4P + 9F + 4C. `targetsForDate` passes it to
 *  `distributeWeekCalories` as part of the per-day floor, so cycling NARROWS
 *  its spread rather than plan a day that can't hold them (owner decision,
 *  the same idea as the kcal floor). Only when the weekly mean itself is
 *  below it (`training.floorsExceedMean`) do the floors give way, in
 *  `proteinCeilingGrams`' order. */
export function minDayKcal(
  input: MacroFloorInput & {
    /** The protein the setting asks for (unrounded) — `proteinGrams`. */
    proteinGrams: number;
  },
): number {
  const step = MACRO_GRAM_STEP;
  const carbFloor = fatMovesForDiet(input.dietType)
    ? 0
    : ceilStep(CARB_FLOOR_G_PER_KG * input.weightKg, step);
  return (
    4 * roundStep(input.proteinGrams, step) +
    9 * ceilStep(fatFloorGrams(input), step) +
    4 * carbFloor
  );
}

export type DayMacroInput = {
  /** The day's planned calories. */
  dayKcal: number;
  /** The weekly mean day from `computeMacros` (its split, or the user's
   *  `macroSplit` override, applied to T): sets the held macro's level. */
  mean: { targetCalories: number; carbs: number; fat: number };
  /** Daily protein the setting asks for (unrounded) — `proteinGrams`. */
  proteinGrams: number;
  weightKg: number;
  /** The kg the 1.2 g/kg protein minimum is taken on (see `MacroFloorInput`). */
  proteinKg: number;
  /** The goal driving the target (a cut allows the 15% fat floor). */
  goal: PersonalInfo["goal"];
  dietType: PersonalInfo["dietType"];
  /** See `MacroFloorInput.explicitFatChoice`. */
  explicitFatChoice: boolean;
};

/** Split a training day's calories into macros. Protein constant and carbs
 *  carrying the day-type difference follow RP Diet Coach and Carbon; the fat
 *  floor is RippedBody's 0.5 g/kg with the IOM's 20% lower bound (Helms
 *  2014's 15% in a cut or for an explicit low-fat choice).
 *
 *  The split depends on the day's CALORIES only, never on its class: a
 *  heavy day gets more carbs only from the extra calories cycling gives it
 *  (owner decision — the ≥ 3 g/kg heavy-day aim of Iraki 2019 / Thomas 2016
 *  is never reached by trading fat below its weekly-average level). With
 *  cycling off every day has the same calories, so every day has the same
 *  macros: only the fixed protein differs from the plain targets.
 *
 *  - Protein: the given grams, capped by this day's `proteinCeilingGrams`.
 *    In a `targetsForDate` week the cap binds only when the weekly mean is
 *    under `minDayKcal`, and then every day is the mean — so protein is the
 *    same every day of the week either way.
 *  - Fat floor: `fatFloorGrams` — max(0.5 g/kg, 20% of the MEAN kcal; 15% in
 *    a cut or when the user explicitly chose a low-fat diet type or a custom
 *    split). It always holds; protein gives way first.
 *  - Default (carbs move): fat holds at the mean day's level (at least the
 *    floor) and carbs take the rest. Every day keeps ≥ 1 g/kg carbs — the
 *    one case where fat trades down from its weekly level, never below its
 *    floor. The 1 g/kg is guaranteed unless 1.2 g/kg protein, the fat floor and 1 g/kg carbs
 *    don't all fit the day — rule 2 of `proteinCeilingGrams` then keeps the
 *    protein and carbs fall short (heavy, short, older users at their BMR
 *    floor: ≥ 138 kg in a 20,000-profile fuzz).
 *  - Low-carb (fat moves): carbs hold at the mean day's level and fat takes
 *    the rest; if that would put fat under its floor, carbs give way.
 *  - Everything is in 5 g steps; the moving macro is derived last from the
 *    rounded others, so 4P + 4C + 9F is within one 5 g step of the moving
 *    macro (≤ 20 kcal for carbs, ≤ 45 kcal for fat) of `dayKcal`.
 *  - A day smaller than the fat floor's own energy (unreachable from
 *    `targetsForDate`, whose days are ≥ max(BMR, 1200)) has no room for
 *    protein or carbs: fat takes the whole day. */
export function partitionDayMacros(input: DayMacroInput): {
  protein: number;
  carbs: number;
  fat: number;
} {
  const step = MACRO_GRAM_STEP;
  const K = input.dayKcal;
  const floors: MacroFloorInput = {
    weightKg: input.weightKg,
    proteinKg: input.proteinKg,
    meanKcal: input.mean.targetCalories,
    goal: input.goal,
    dietType: input.dietType,
    explicitFatChoice: input.explicitFatChoice,
  };
  const fatFloor = fatFloorGrams(floors);
  const fatFloorStep = ceilStep(fatFloor, step);
  const P = Math.min(
    roundStep(input.proteinGrams, step),
    proteinCeilingGrams({
      ...floors,
      dayKcal: K,
      proteinGrams: input.proteinGrams,
    }),
  );
  const afterProtein = K - 4 * P;
  if (afterProtein < 9 * fatFloorStep) {
    return { protein: P, carbs: 0, fat: floorStep(afterProtein / 9, step) };
  }

  if (fatMovesForDiet(input.dietType)) {
    let C = roundStep(Math.max(0, input.mean.carbs), step);
    if ((afterProtein - 4 * C) / 9 < fatFloor) {
      C = floorStep((afterProtein - 9 * fatFloorStep) / 4, step);
    }
    let F = roundStep((afterProtein - 4 * C) / 9, step);
    if (F < fatFloor) F += step;
    return { protein: P, carbs: C, fat: F };
  }

  const carbFloor = ceilStep(CARB_FLOOR_G_PER_KG * input.weightKg, step);
  const held = Math.max(input.mean.fat, fatFloor);
  let F = Math.max(roundStep(held, step), fatFloorStep);
  if ((afterProtein - 9 * F) / 4 < carbFloor) {
    // Make room for the carb floor from fat, down to (never past) its floor.
    const room = (afterProtein - 4 * carbFloor) / 9;
    F = Math.min(F, Math.max(fatFloorStep, floorStep(room, step)));
  }
  const C = roundStep((afterProtein - 9 * F) / 4, step);
  return { protein: P, carbs: C, fat: F };
}
