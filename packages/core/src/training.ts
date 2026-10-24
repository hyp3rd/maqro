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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === "string" && (options as readonly string[]).includes(v);
}

/** Validate one stored session at read time: `null` unless it is an object
 *  with a known `type`; malformed optional fields (`intensity`, a
 *  non-`HH:MM` `time`, a non-positive / over-24 h `durationMin`) are dropped
 *  and unknown keys stripped. Returns a fresh object (never persisted back).
 *
 *  This is how a per-date override's `day` is read (`targetsForDate`): a
 *  malformed override is IGNORED — the day keeps its template session —
 *  rather than turned into a rest day the user never chose. */
export function parseTrainingDay(raw: unknown): TrainingDay | null {
  if (!isRecord(raw) || !isOneOf(raw.type, TRAINING_TYPES)) return null;
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

/** A template weekday: a malformed entry is a rest day (the week always has
 *  seven). */
function normalizeTrainingDay(raw: unknown): TrainingDay {
  return parseTrainingDay(raw) ?? { type: "rest" };
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
 *  5. Rounding to 50 kcal PER WEIGHT GROUP (`roundWeightGroups`): every day
 *     of the same cycling weight gets the same kcal (a long-endurance day
 *     and a heavy day weigh the same, so they plan the same), each group
 *     rounded down or up to the 50 kcal grid, choosing the combination
 *     whose weekly sum is closest to 7T.
 *
 *  Guarantee (when a spread exists): every day is a multiple of 50 within
 *  the bounds; equal weights ⇒ equal kcal; a heavier day is never planned
 *  below a lighter one; and the week's sum is within 25 × n kcal of 7T,
 *  where n is the size of the largest group whose raw day is off the grid —
 *  so within 25 kcal when every such group is a single day, and never more
 *  than 150 kcal a week (≈ 21 kcal a day: a group has at most 6 days, as a
 *  week with a spread has two weights at least). Rounding whole groups is
 *  what costs the exactness of a per-day rounding: a 3-day group can only
 *  move the week in 150 kcal steps. (Proof of the bound: rounding the groups
 *  up one at a time, heaviest first, walks the sum from ≤ 7T to ≥ 7T in
 *  steps of 50 × (group size), and every prefix keeps the order.) */
export function distributeWeekCalories(input: WeekCaloriesInput): number[] {
  const { meanKcal: mean, classes } = input;
  const flat = () => classes.map(() => mean);
  const scale = weekCalorieScale(input);
  if (!scale) return flat();
  const weights = classes.map((c) => scale.weights[c]);
  if (weights.every((w) => w === weights[0])) return flat();
  const byWeight = roundedDaysByWeight(scale, classes);
  return weights.map((w) => byWeight.get(w) ?? mean);
}

/** The template's planned kcal for each cycling weight it uses: its days
 *  grouped by weight (`classes` → the scale's weights), each group's
 *  `scaledDay` rounded together by `roundWeightGroups`. */
function roundedDaysByWeight(
  scale: WeekCalorieScale,
  classes: readonly TrainingDayClass[],
): Map<number, number> {
  const groups = new Map<number, { x: number; n: number }>();
  for (const c of classes) {
    const w = scale.weights[c];
    const group = groups.get(w);
    if (group) group.n += 1;
    else groups.set(w, { x: scaledDay(scale, c), n: 1 });
  }
  const weightsDesc = [...groups.keys()].sort((a, b) => b - a);
  const rounded = roundWeightGroups(
    weightsDesc.map((w) => groups.get(w) ?? { x: scale.mean, n: 0 }),
    classes.length * scale.mean,
  );
  return new Map(weightsDesc.map((w, i) => [w, rounded[i]]));
}

/** Round each group's day `x` (the same for its `n` days) down or up to the
 *  50 kcal grid. `groups` come heaviest first (strictly decreasing `x`);
 *  returns the rounded day per group, in that order. Of the 2^G
 *  combinations (G ≤ 5 weights) that keep the order — a heavier group never
 *  rounds below a lighter one — it takes the one whose weekly sum
 *  Σ n × day is closest to `target` (7T); on a tie the one closest to the
 *  raw days (least Σ n × |day − x|), then the lower week (never plan more
 *  than the goal when equally close), then the one rounding the heavier
 *  groups up (the training days get the extra step). */
function roundWeightGroups(
  groups: readonly { x: number; n: number }[],
  target: number,
): number[] {
  const EPS = 1e-9;
  const G = groups.length;
  let best: { days: number[]; err: number; dev: number; sum: number } | null =
    null;
  // Bit (G − 1 − i) of `mask` rounds group i up. Counting down visits the
  // combinations with the heavier groups up first, so a full tie keeps the
  // first one seen.
  for (let mask = (1 << G) - 1; mask >= 0; mask--) {
    const days = groups.map(({ x }, i) =>
      (mask >> (G - 1 - i)) & 1
        ? ceilStep(x, DAY_KCAL_STEP)
        : floorStep(x, DAY_KCAL_STEP),
    );
    if (days.some((d, i) => i > 0 && d > days[i - 1])) continue;
    const sum = groups.reduce((s, { n }, i) => s + n * days[i], 0);
    const err = Math.abs(sum - target);
    const dev = groups.reduce(
      (s, { x, n }, i) => s + n * Math.abs(days[i] - x),
      0,
    );
    if (
      best === null ||
      err < best.err - EPS ||
      (err < best.err + EPS &&
        (dev < best.dev - EPS || (dev < best.dev + EPS && sum < best.sum)))
    ) {
      best = { days, err, dev, sum };
    }
  }
  // The all-down combination always keeps the order, so `best` is set.
  return best?.days ?? groups.map(({ x }) => floorStep(x, DAY_KCAL_STEP));
}

/** A template week's calorie scale (`distributeWeekCalories` steps 2–4):
 *  the class weights, their mean over the template, the day bounds and the
 *  narrowing factor α. `null` when every day is the mean (cycling off, or
 *  bounds / narrowing that leave the mean no room). */
type WeekCalorieScale = {
  mean: number;
  weights: Record<TrainingDayClass, number>;
  meanWeight: number;
  lo: number;
  hi: number;
  alpha: number;
};

function weekCalorieScale(input: WeekCaloriesInput): WeekCalorieScale | null {
  const { meanKcal: mean, classes, cycling } = input;
  if (cycling === "off") return null;

  const table = CYCLING_WEIGHTS[cycling];
  const weights = classes.map((c) => table[c]);
  const meanWeight = weights.reduce((s, w) => s + w, 0) / weights.length;
  const raw = weights.map((w) => (mean * w) / meanWeight);

  const lo = ceilStep(
    Math.max(input.floorKcal, DAY_MIN_OF_MEAN * mean, ABSOLUTE_MIN_DAY_KCAL),
    DAY_KCAL_STEP,
  );
  const hi = floorStep(DAY_MAX_OF_MEAN * mean, DAY_KCAL_STEP);
  if (lo > mean || hi < mean) return null;

  let alpha = 1;
  for (const r of raw) {
    if (r < mean) alpha = Math.min(alpha, (mean - lo) / (mean - r));
    else if (r > mean) alpha = Math.min(alpha, (hi - mean) / (r - mean));
  }
  if (alpha <= 0) return null;
  return { mean, weights: table, meanWeight, lo, hi, alpha };
}

/** A day of `dayClass` on the scale, before rounding: T + α(raw − T). */
function scaledDay(scale: WeekCalorieScale, dayClass: TrainingDayClass) {
  const { mean, alpha } = scale;
  const raw = (mean * scale.weights[dayClass]) / scale.meanWeight;
  return clean(mean + alpha * (raw - mean));
}

/** The planned kcal for ONE day of `dayClass` under the template week's
 *  scale — a per-date session override (`targetsForDate`): the same
 *  weights, normalized to the TEMPLATE's mean weight, and the template's
 *  narrowing α. A weight the template uses plans exactly what the
 *  template's days of that weight plan (equal weights ⇒ equal kcal, the
 *  group rounding included); any other is rounded to the nearest 50 kcal
 *  and held inside the day bounds [max(floor, 0.80T, 800), 1.25T] (a class
 *  the template doesn't use can fall outside the range α was fitted to).
 *  The mean itself when the week has no spread (cycling off, or no room
 *  above the floor).
 *
 *  Only that day changes — nothing is rebalanced across the rest of the
 *  week (no calorie banking), so the overridden week sums to the template
 *  week plus this day's difference from its template day. */
export function dayKcalForClass(
  input: WeekCaloriesInput,
  dayClass: TrainingDayClass,
): number {
  const scale = weekCalorieScale(input);
  if (!scale) return input.meanKcal;
  const weight = scale.weights[dayClass];
  const template = distributeWeekCalories(input);
  const sameWeight = input.classes.findIndex(
    (c) => scale.weights[c] === weight,
  );
  if (sameWeight !== -1) return template[sameWeight];
  const day = roundStep(scaledDay(scale, dayClass), DAY_KCAL_STEP);
  return Math.min(scale.hi, Math.max(scale.lo, day));
}

/** Above this BMI, with no body-fat estimate, protein g/kg tapers off total
 *  bodyweight toward the reference weight (`proteinWeightKg`). */
export const OBESE_BMI = 30;
/** From this BMI up, the taper has reached the reference weight. */
export const TAPER_END_BMI = 35;
/** The BMI the reference weight is taken at. */
export const REFERENCE_BMI = 25;

/** The weight (kg) at BMI 25 for a height in cm (180 cm → 81 kg), or
 *  `null` for a height that isn't a positive number. */
export function referenceWeightKg(heightCm: number): number | null {
  if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
  return REFERENCE_BMI * (heightCm / 100) ** 2;
}

/** The weight protein g/kg is taken on when there is NO usable body-fat
 *  estimate (owner refinement: a taper, so protein never steps at BMI 30):
 *
 *  | BMI      | protein weight                                         |
 *  |----------|--------------------------------------------------------|
 *  | ≤ 30     | bodyweight                                             |
 *  | 30 – 35  | linear from the BMI-30 weight for the height (at BMI   |
 *  |          | 30) to the BMI-25 reference weight (at BMI 35)         |
 *  | ≥ 35     | the BMI-25 reference weight                            |
 *
 *  180 cm: 97.2 kg (BMI 30) → 97.2; 105.3 kg (BMI 32.5) → 89.1; from
 *  113.4 kg (BMI 35) up → 81. Continuous at both ends, and below
 *  bodyweight everywhere above BMI 30, as total weight over-prescribes
 *  protein with more body fat (Carbon and MacroFactor ask for a body-fat
 *  estimate there). A height that isn't a positive number → bodyweight. */
export function proteinWeightKg(weightKg: number, heightCm: number): number {
  const reference = referenceWeightKg(heightCm);
  if (reference === null) return weightKg;
  // BMI = weight / height² = REFERENCE_BMI × weight / reference. The ends
  // are compared without float noise; the taper itself uses the exact BMI.
  const bmi = (REFERENCE_BMI * weightKg) / reference;
  if (!(clean(bmi) > OBESE_BMI)) return weightKg;
  if (clean(bmi) >= TAPER_END_BMI) return reference;
  const atObese = (OBESE_BMI / REFERENCE_BMI) * reference;
  const t = (bmi - OBESE_BMI) / (TAPER_END_BMI - OBESE_BMI);
  return atObese + t * (reference - atObese);
}

/** The body measure protein g/kg was actually applied to. `referenceWeight`
 *  covers the whole BMI > 30 rule without a body-fat estimate — the taper
 *  from 30 to 35 as well as the BMI-25 reference weight from 35 up — i.e.
 *  any protein weight below bodyweight (`proteinWeightKg`). */
export type ProteinBasis = ProteinSetting["basis"] | "referenceWeight";

/** What `proteinGrams` reads about the body. */
export type ProteinBody = {
  weightKg: number;
  heightCm: number;
  /** The latest body-fat estimate (%), if any. */
  bodyFatPct?: number | null;
};

/** `proteinGrams`' result. */
export type ProteinTarget = {
  grams: number;
  /** The basis actually used (see `ProteinBasis`). */
  basis: ProteinBasis;
  /** The kg the g/kg was applied to, and the kg every per-kg floor is
   *  taken on (`MacroFloorInput.floorKg`): bodyweight, or the protein
   *  weight below it at BMI > 30 without a body-fat estimate — never lean
   *  mass, as no floor is a per-kg-of-FFM figure. */
  kg: number;
  /** A plausible body-fat estimate would change `grams`: true exactly for
   *  the lean-mass fallback (a `leanMass` setting without one) and for the
   *  BMI > 30 protein weight (`basis: "referenceWeight"`). The UI's cue to
   *  suggest adding a body-fat estimate. */
  bodyFatWouldChangeProtein: boolean;
};

/** Daily protein grams for the setting, and the kg its g/kg was applied to:
 *
 *  - `leanMass` setting with a plausible body-fat estimate (3–60 %): g/kg ×
 *    lean mass (weight × (1 − body fat %)).
 *  - `bodyweight` setting with one: its g/kg × bodyweight, as set.
 *  - No usable estimate: g/kg × `proteinWeightKg` (bodyweight up to BMI 30,
 *    then the taper to the BMI-25 reference weight), where a `leanMass`
 *    setting's g/kg is capped at the 2.0 g/kg default — its figure is per
 *    kg of FFM and over-prescribes on total weight, while a lower choice
 *    (e.g. 1.4) is kept (owner decisions; 80 kg: 1.4 → 112 g, 2.6 → 160 g).
 *
 *  `basis` is the one actually used and `bodyFatWouldChangeProtein` says
 *  whether a body-fat estimate would change the grams. */
export function proteinGrams(
  setting: ProteinSetting,
  body: ProteinBody,
): ProteinTarget {
  const { weightKg, bodyFatPct } = body;
  const hasBodyFat =
    typeof bodyFatPct === "number" &&
    Number.isFinite(bodyFatPct) &&
    bodyFatPct >= BODY_FAT_MIN_PCT &&
    bodyFatPct <= BODY_FAT_MAX_PCT;
  if (hasBodyFat) {
    return {
      grams:
        setting.basis === "leanMass"
          ? setting.gPerKg * weightKg * (1 - bodyFatPct / 100)
          : setting.gPerKg * weightKg,
      basis: setting.basis,
      kg: weightKg,
      bodyFatWouldChangeProtein: false,
    };
  }
  const gPerKg =
    setting.basis === "leanMass"
      ? Math.min(setting.gPerKg, DEFAULT_PROTEIN_SETTING.gPerKg)
      : setting.gPerKg;
  const kg = proteinWeightKg(weightKg, body.heightCm);
  const tapered = kg < weightKg;
  return {
    grams: gPerKg * kg,
    basis: tapered ? "referenceWeight" : "bodyweight",
    kg,
    bodyFatWouldChangeProtein: tapered || setting.basis === "leanMass",
  };
}

/** Diets where FAT absorbs the day-to-day difference and carbs hold (low-carb,
 *  and any keto variant should one be added to `dietType`). */
export function fatMovesForDiet(dietType: PersonalInfo["dietType"]): boolean {
  return dietType === "lowCarb";
}

/** Every carb-moving day keeps at least this many g/kg of carbs
 *  (RippedBody's minimum; a low-carb diet has no carb floor). */
export const CARB_FLOOR_G_PER_KG = 1;

/** The carb floor in planned grams: 1 g/kg (on `floorKg`) on the 5 g grid
 *  taken upward, or 0 on a fat-moving diet. */
function carbFloorStep(
  input: Pick<MacroFloorInput, "floorKg" | "dietType">,
): number {
  return fatMovesForDiet(input.dietType)
    ? 0
    : ceilStep(CARB_FLOOR_G_PER_KG * input.floorKg, MACRO_GRAM_STEP);
}

/** What sets a day's macro floors. */
export type MacroFloorInput = {
  /** The kg every per-kg floor is taken on — the 0.5 g/kg fat floor, the
   *  1 g/kg carb floor and the 1.2 g/kg protein minimum: `proteinGrams`'
   *  `kg`. That is bodyweight, except at BMI > 30 without a body-fat
   *  estimate, where it is the same tapered / reference weight the protein
   *  g/kg is taken on (owner refinement: the floors follow the protein
   *  weight); with an estimate the floors stay on bodyweight. */
  floorKg: number;
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
/** Every fat floor is also at least this many g/kg (RippedBody; Iraki
 *  2019), on `MacroFloorInput.floorKg`. */
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
    FAT_FLOOR_G_PER_KG * input.floorKg,
    (share * input.meanKcal) / 9,
  );
}

/** The most protein (g, a 5 g step) a day of `dayKcal` can hold without
 *  breaking a macro floor: when they collide, the protein setting is what
 *  gives way. Precedence, highest first:
 *
 *  1. The fat floor — always held (RP's 15% hard floor; Helms 2014).
 *  2. Protein up to the lesser of the setting and 1.2 g/kg (the any-goal
 *     floor, DGA 2025–2030), on `floorKg`.
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
  const carbFloor = carbFloorStep(input);
  const withCarbFloor = floorStep((afterFat - 4 * carbFloor) / 4, step);
  const withFatFloorOnly = floorStep(afterFat / 4, step);
  const proteinFloor = Math.min(
    roundStep(input.proteinGrams, step),
    roundStep(PROTEIN_G_PER_KG_MIN * input.floorKg, step),
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
  const carbFloor = carbFloorStep(input);
  return (
    4 * roundStep(input.proteinGrams, step) +
    9 * ceilStep(fatFloorGrams(input), step) +
    4 * carbFloor
  );
}

/** Why even the weekly-average day can't hold the protein setting and the
 *  macro floors (`training.floorsExceedMean`), so the UI can suggest the
 *  change that helps:
 *
 *  - `protein`: the setting asks for more protein than the 2.0 g/kg default
 *    would on the same basis and weight, and the mean day fits at 2.0 — a
 *    high setting, typically with the mean at the BMR floor where a smaller
 *    deficit can't add calories. Suggest a lower protein setting.
 *  - `calories`: anything else (the mean doesn't fit even at 2.0, or the
 *    setting is already at or under it). Suggest a smaller deficit. */
export type FloorsExceedMeanCause = "protein" | "calories";

/** The `FloorsExceedMeanCause` for a week whose mean is under `minDayKcal`.
 *  `setting` and `body` are what `proteinGrams` read; the 2.0 g/kg
 *  comparison keeps the setting's basis, so a lean-mass fallback (already
 *  capped at 2.0 g/kg) is `calories`. The floors' kg is the same either
 *  way: it depends on the body, not on the g/kg. */
export function floorsExceedMeanCause(
  input: MacroFloorInput & { setting: ProteinSetting; body: ProteinBody },
): FloorsExceedMeanCause {
  const asked = proteinGrams(input.setting, input.body);
  const atDefault = proteinGrams(
    {
      ...input.setting,
      gPerKg: Math.min(input.setting.gPerKg, DEFAULT_PROTEIN_SETTING.gPerKg),
    },
    input.body,
  );
  return atDefault.grams < asked.grams &&
    input.meanKcal >= minDayKcal({ ...input, proteinGrams: atDefault.grams })
    ? "protein"
    : "calories";
}

/** What a training week's macro levels depend on: everything a day's split
 *  reads except the day's own calories. */
export type WeekMacroInput = {
  /** The smallest PLANNED day of the week (kcal): the least of
   *  `distributeWeekCalories`' seven days (the mean itself with cycling
   *  off). The week's held levels are set on it, so every day shares them. */
  weekMinKcal: number;
  /** The weekly mean day from `computeMacros` (its split, or the user's
   *  `macroSplit` override, applied to T): sets the held macro's level. */
  mean: { targetCalories: number; carbs: number; fat: number };
  /** Daily protein the setting asks for (unrounded) — `proteinGrams`. */
  proteinGrams: number;
  /** The kg every per-kg floor is taken on (see `MacroFloorInput`). */
  floorKg: number;
  /** The goal driving the target (a cut allows the 15% fat floor). */
  goal: PersonalInfo["goal"];
  dietType: PersonalInfo["dietType"];
  /** See `MacroFloorInput.explicitFatChoice`. */
  explicitFatChoice: boolean;
};

export type DayMacroInput = WeekMacroInput & {
  /** The day's planned calories. A `weekMinKcal` above it is taken as it
   *  (the day is then the week's smallest). */
  dayKcal: number;
};

function macroFloors(input: WeekMacroInput): MacroFloorInput {
  return {
    floorKg: input.floorKg,
    meanKcal: input.mean.targetCalories,
    goal: input.goal,
    dietType: input.dietType,
    explicitFatChoice: input.explicitFatChoice,
  };
}

/** The levels a training week holds on every day (5 g steps), both set on
 *  its smallest planned day (`weekMinKcal`):
 *
 *  - `protein`: the setting, capped by that day's `proteinCeilingGrams`.
 *  - `held`: fat on a carb-moving diet, carbs on a fat-moving one — the
 *    split's weekly level (`choice`, the mean day's: fat at least the fat
 *    floor), lowered only as far as the smallest day needs to keep
 *    protein + it + the moving macro's floor (the 1 g/kg carb floor / the
 *    fat floor), never below its own floor (the fat floor / 0 g carbs). */
function weekHeldLevels(input: WeekMacroInput): {
  protein: number;
  held: number;
  choice: number;
} {
  const step = MACRO_GRAM_STEP;
  const smallest = input.weekMinKcal;
  const floors = macroFloors(input);
  const fatFloor = fatFloorGrams(floors);
  const fatFloorStep = ceilStep(fatFloor, step);
  const protein = Math.min(
    roundStep(input.proteinGrams, step),
    proteinCeilingGrams({
      ...floors,
      dayKcal: smallest,
      proteinGrams: input.proteinGrams,
    }),
  );
  const afterProtein = smallest - 4 * protein;
  if (fatMovesForDiet(input.dietType)) {
    const choice = roundStep(Math.max(0, input.mean.carbs), step);
    const room = floorStep((afterProtein - 9 * fatFloorStep) / 4, step);
    return { protein, held: Math.max(0, Math.min(choice, room)), choice };
  }
  const choice = Math.max(
    roundStep(Math.max(input.mean.fat, fatFloor), step),
    fatFloorStep,
  );
  const room = floorStep((afterProtein - 4 * carbFloorStep(floors)) / 9, step);
  return {
    protein,
    held: Math.min(choice, Math.max(fatFloorStep, room)),
    choice,
  };
}

/** `computeMacros` rounds fat to whole grams, so the user's chosen level is
 *  only known to within this much. */
const FAT_ROUNDING_G = 0.5;

/** Whether the fat floor lifted the user's EXPLICIT fat choice — the plan's
 *  fat is above what their `lowFat` diet or custom split yields for the
 *  mean day because of the floor (`training.fatFloorLifted`: the UI's info
 *  note). Never true for a default split: that isn't the user's choice.
 *
 *  Both diet directions first need the same thing: the split's mean-day
 *  fat (the user's choice, `mean.fat`) is under the fat floor, beyond
 *  `computeMacros`' whole-gram rounding. A choice at or over the floor is
 *  never lifted by it, whatever else the week does.
 *
 *  - Carb-moving diet: the choice IS the week's fat level, so the plan
 *    holds the floor instead — lifted.
 *  - Fat-moving diet: fat is what remains beside the fixed protein and the
 *    held carbs, so a choice under the floor is often already exceeded
 *    because of the protein (a 50/40/10 split usually yields far more fat
 *    than 10%), not the floor. It is lifted only when the floor also
 *    lowered the week's carbs under the split's (the smallest planned day
 *    couldn't hold the fat floor), which puts every day's fat — the mean
 *    day's included — at or over the floor, so above the choice. A high-fat
 *    choice whose carbs the floor lowered (a 3.4 g/kg protein setting
 *    leaving the smallest day little room) is not flagged: its fat stays
 *    under what the user chose. */
export function fatFloorLiftsChoice(input: WeekMacroInput): boolean {
  if (!input.explicitFatChoice) return false;
  const choiceUnderFloor =
    input.mean.fat + FAT_ROUNDING_G < fatFloorGrams(macroFloors(input));
  if (!choiceUnderFloor || !fatMovesForDiet(input.dietType)) {
    return choiceUnderFloor;
  }
  const { held, choice } = weekHeldLevels(input);
  return held < choice;
}

/** Split a training day's calories into macros. Protein constant and carbs
 *  carrying the day-type difference follow RP Diet Coach and Carbon; the fat
 *  floor is RippedBody's 0.5 g/kg with the IOM's 20% lower bound (Helms
 *  2014's 15% in a cut or for an explicit low-fat choice).
 *
 *  ONE LEVEL PER WEEK (owner refinement): protein and the held macro — fat
 *  on a carb-moving diet, carbs on a fat-moving one — are the same on every
 *  day of the week (`weekHeldLevels`, set on the smallest planned day,
 *  `weekMinKcal`), and the moving macro takes each day's calories. So a
 *  day's split depends on its CALORIES only, never on its class, and every
 *  cycled calorie lands on the moving macro: a heavy day gets more carbs
 *  only from the extra calories cycling gives it (the ≥ 3 g/kg heavy-day
 *  aim of Iraki 2019 / Thomas 2016 is never reached by trading fat), and a
 *  bigger day never has fewer carbs than a smaller one. With cycling off
 *  every day is the mean, so only the fixed protein differs from the plain
 *  targets.
 *
 *  | diet                   | held all week             | moves with the day |
 *  |------------------------|---------------------------|--------------------|
 *  | carb-moving (default)  | fat: the split's level,   | carbs: ≥ 1 g/kg on |
 *  |                        | lowered toward (never     | the smallest day   |
 *  |                        | under) the fat floor      |                    |
 *  | fat-moving (`lowCarb`) | carbs: the split's level, | fat: ≥ the fat     |
 *  |                        | lowered toward (never     | floor on the       |
 *  |                        | under) 0 g                | smallest day       |
 *
 *  The held level is lowered only as far as the smallest day needs to keep
 *  protein + the held level + the moving macro's floor. Only if even the
 *  held macro's own floor can't make room does the cycling spread narrow
 *  (`targetsForDate` passes `minDayKcal` to `distributeWeekCalories`), and
 *  only if the MEAN day can't fit (`training.floorsExceedMean`, every day
 *  then at the mean) do the floors give way, in `proteinCeilingGrams`'
 *  order: the fat floor holds, then protein ≥ 1.2 g/kg, then carbs ≥
 *  1 g/kg, then the rest of the protein. Carbs then fall short of 1 g/kg
 *  only for very heavy users at (or just above) their BMR floor.
 *
 *  - Fat floor: `fatFloorGrams` — max(0.5 g/kg on `floorKg`, 20% of the
 *    MEAN kcal; 15% in a cut or when the user explicitly chose a low-fat
 *    diet type or a custom split). It always holds; protein gives way
 *    first.
 *  - Everything is in 5 g steps; the moving macro is derived last from the
 *    rounded others, so 4P + 4C + 9F is within half a 5 g step of the
 *    moving macro (≤ 10 kcal for carbs, ≤ 22.5 kcal for fat) of `dayKcal`.
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
  const { protein: P, held } = weekHeldLevels({
    ...input,
    weekMinKcal: Math.min(input.weekMinKcal, K),
  });
  const afterProtein = K - 4 * P;
  const fatFloorStep = ceilStep(fatFloorGrams(macroFloors(input)), step);
  if (afterProtein < 9 * fatFloorStep) {
    return { protein: P, carbs: 0, fat: floorStep(afterProtein / 9, step) };
  }
  if (fatMovesForDiet(input.dietType)) {
    const F = roundStep((afterProtein - 4 * held) / 9, step);
    return { protein: P, carbs: held, fat: F };
  }
  const C = roundStep((afterProtein - 9 * held) / 4, step);
  return { protein: P, carbs: C, fat: held };
}
