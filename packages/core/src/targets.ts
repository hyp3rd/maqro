import { addDays } from "./date";
import { effectiveGoal } from "./goal-phases";
import { computeMacros } from "./macros";
import {
  type FloorsExceedMeanCause,
  MACRO_GRAM_STEP,
  type ProteinBasis,
  type TrainingDayClass,
  classifyTrainingDay,
  dayKcalForClass,
  distributeWeekCalories,
  explicitFatChoice,
  fatFloorLiftsChoice,
  floorsExceedMeanCause,
  minDayKcal,
  normalizeProteinSetting,
  normalizeTrainingSchedule,
  parseTrainingDay,
  partitionDayMacros,
  proteinGrams,
} from "./training";
import {
  type CalculatedValues,
  type CyclingPreset,
  type GoalPhase,
  MIN_DAILY_KCAL,
  type PersonalInfo,
  type TrainingDay,
} from "./types";

/** The ONE resolver for a calendar day's calorie/macro target. Every surface
 *  that shows or sends a target (the app's day view + calculator, the AI
 *  planners, /report, the weekly-recap email, the auto-adapt cron) goes
 *  through here, so they can never disagree about the same day.
 *
 *  Pipeline: the goal phase covering `date` (when the caller has cleared the
 *  Pro gate) → that phase's goal/rate and optional TDEE override → the shared
 *  `computeMacros` engine, with the age clock pinned to local midnight of
 *  `date`. With an enabled training schedule (FREE) that result is the
 *  WEEKLY MEAN, and the day's own planned share of it comes from the
 *  template (training.ts) — or, when the user changed that one day's
 *  session (a per-date override, FREE), from the override's class on the
 *  template week's scale. Pure: the date, the tier decision, any body-fat
 *  estimate and any overrides are inputs, never read from the environment,
 *  so it runs identically on web, server and native. */

/** What the caller has resolved about the user before asking for a target.
 *  Gating lives in callers (see goal-phases.ts): pass `phasesEnabled: true`
 *  only after the tier check (`FEATURES.canUseGoalPhases`). `bodyFatPct` is
 *  the latest body-fat estimate (%) if the caller has one — the training
 *  protein reads it (`proteinGrams`): absent, a lean-mass setting takes
 *  min(2.0, its g/kg) on bodyweight, and above BMI 30 g/kg is taken on a
 *  protein weight that tapers to the BMI-25 reference weight at BMI 35. */
export type TargetContext = {
  phasesEnabled: boolean;
  bodyFatPct?: number | null;
  /** The user's per-date session override for a date, if any — the stored
   *  `training_day_overrides` row's `day`, raw (`dayOverrideResolver` builds
   *  this from the rows). `targetsForDate` reads it for its own date only
   *  and validates it there (`parseTrainingDay`): a malformed row is
   *  ignored, and every override is ignored while the training schedule is
   *  off. Absent = no overrides (the template week as planned). */
  overrideFor?: (date: string) => unknown;
};

/** The `TargetContext.overrideFor` for a set of stored override rows (one
 *  per date, as the table's primary key guarantees): the row's raw `day`
 *  for its date, `undefined` for any other. */
export function dayOverrideResolver(
  rows: Iterable<{ date: string; day: unknown }>,
): (date: string) => unknown {
  const byDate = new Map<string, unknown>();
  for (const row of rows) byDate.set(row.date, row.day);
  return (date) => byDate.get(date);
}

/** What drove a training-day target (present only while a schedule is on). */
export type TrainingDayTargets = {
  /** The session the day is planned for: the date's override when there is
   *  a valid one, else the template entry for its weekday. */
  day: TrainingDay;
  /** The template entry for this weekday (what "back to plan" restores). */
  plannedDay: TrainingDay;
  /** A per-date override replaced the template session for this day. */
  overridden: boolean;
  dayClass: TrainingDayClass;
  cycling: CyclingPreset;
  /** The weekly mean daily target the day is planned around. */
  meanCalories: number;
  /** The protein basis actually used (`proteinGrams`): `bodyweight`,
   *  `leanMass` (only with a body-fat estimate), or `referenceWeight` (BMI
   *  > 30 without one: g/kg on the protein weight that tapers from the
   *  BMI-30 to the BMI-25 weight for the height, `proteinWeightKg`). */
  proteinBasis: ProteinBasis;
  /** A body-fat estimate would change this protein target — the UI's cue
   *  to suggest adding one. True exactly for the lean-mass fallback (a
   *  `leanMass` setting without an estimate, which takes min(2.0, its g/kg)
   *  on bodyweight) and for `referenceWeight`; `proteinBasis` alone can't
   *  tell the fallback from a chosen bodyweight setting. */
  bodyFatWouldChangeProtein: boolean;
  /** `false`, or why even the weekly-average day can't hold the protein
   *  setting, the fat floor and the 1 g/kg carb floor together (its kcal is
   *  under `minDayKcal`) — what the UI should gently suggest
   *  (`FloorsExceedMeanCause`): `"protein"` when a setting above 2.0 g/kg
   *  is what doesn't fit (suggest a lower setting), else `"calories"`
   *  (suggest a smaller deficit). Truthy exactly when the floors exceed the
   *  mean. Every day then sits at the mean, and the floors give way in
   *  `proteinCeilingGrams`' order: the fat floor holds, then protein ≥
   *  1.2 g/kg, then carbs ≥ 1 g/kg, then the rest of the protein. When
   *  false, every planned day holds all of them: cycling narrows its spread
   *  rather than plan a day that can't. */
  floorsExceedMean: false | FloorsExceedMeanCause;
  /** The daily protein (g) the setting asks for, on the same 5 g grid as
   *  the planned `protein`. The two are equal unless the floors made
   *  protein give way (`floorsExceedMean`), so a planned `protein` under
   *  it is the UI's cue to say protein is held below the setting for now
   *  and by how much. */
  requestedProtein: number;
  /** The fat floor raised the plan's fat above what the user's explicit fat
   *  choice (a `lowFat` diet type or a custom macro split) yields for the
   *  mean day — the UI's info note (`fatFloorLiftsChoice`). Always needs
   *  the choice's mean-day fat under the fat floor (max(15% of the mean
   *  kcal, 0.5 g/kg)). Carb-moving: the week then holds the floor.
   *  Low-carb: also the floor lowered the week's carbs under the split's,
   *  raising fat on every day; a low fat share that the fixed protein
   *  already lifted well above the floor, or a high-fat choice whose carbs
   *  the floor lowered, is not flagged. */
  fatFloorLifted: boolean;
};

/** A day's resolved target: the engine output plus what produced it.
 *
 *  With an enabled training schedule, `targetCalories` and the three macros
 *  are the DAY's planned values, while `bmr`, `tdee`, `dailyDelta` and
 *  `requestedDelta` stay the weekly-average energy balance (what moves the
 *  weight trend) and `training` says how the day was planned. Without one,
 *  there is no `training` key and every value is `computeMacros`' own. */
export type DateTargets = CalculatedValues & {
  /** The local `YYYY-MM-DD` these targets are for. */
  date: string;
  /** The goal direction actually driving the target — the covering phase's
   *  when one applies, else the profile's linear goal. */
  goal: PersonalInfo["goal"];
  /** The goal phase driving the target, or `null` (linear goal). */
  phase: GoalPhase | null;
  training?: TrainingDayTargets;
};

/** Local midnight of a `YYYY-MM-DD` key, or `undefined` for a key that isn't
 *  a real calendar date (e.g. the empty key `useToday` returns before
 *  hydration). Component-based like `addDays`, so DST never shifts the day.
 *
 *  "Local" is the PROCESS timezone (`new Date(y, m, d)`): the user's zone in
 *  the browser, but UTC on the server, so in the crons the instant is UTC
 *  midnight of `date`. That only moves the age clock (a birthdate-derived
 *  age rolls over at UTC rather than local midnight), never which day — and
 *  so which goal phase or training weekday — the target is resolved for. */
function localMidnight(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(y, m - 1, d);
  // Reject roll-overs like 2026-02-31 → March 3.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d)
    return undefined;
  return dt;
}

/** Whether `targetsForDate` reads `ctx.bodyFatPct` for this profile: only
 *  an enabled training schedule's protein does. Without one the targets are
 *  identical with or without an estimate, so a caller that has to fetch it
 *  (the crons' measurement read) can skip the read and pass `null`. */
export function targetsUseBodyFat(
  profile: Pick<PersonalInfo, "training">,
): boolean {
  return normalizeTrainingSchedule(profile.training)?.enabled === true;
}

/** Whether `targetsForDate` reads `ctx.overrideFor` for this profile: a
 *  per-date session override applies only while the training schedule is
 *  enabled. Otherwise every override is ignored, so a caller that has to
 *  fetch the rows (the weekly-recap cron) can skip the read. */
export function targetsUseOverrides(
  profile: Pick<PersonalInfo, "training">,
): boolean {
  return normalizeTrainingSchedule(profile.training)?.enabled === true;
}

/** Resolve the calorie/macro target for `date` (local `YYYY-MM-DD`). */
export function targetsForDate(
  profile: PersonalInfo,
  date: string,
  ctx: TargetContext,
): DateTargets {
  const effective = effectiveGoal(profile, date, {
    phasesEnabled: ctx.phasesEnabled,
  });
  const midnight = localMidnight(date);
  // `computeMacros` falls back to the present clock for a non-date key.
  const values = computeMacros(
    { ...profile, goal: effective.goal, weeklyRateKg: effective.weeklyRateKg },
    midnight?.getTime(),
    // The covering phase's own maintenance override (Pro), if set, wins over
    // the global manualTdee; computeMacros ignores null / ≤ 0.
    effective.phase?.tdeeOverride ?? undefined,
  );
  const base: DateTargets = {
    ...values,
    date,
    goal: effective.goal,
    phase: effective.phase,
  };

  // No enabled schedule (absent, disabled or malformed) → exactly the above.
  // A non-date key has no weekday to plan, so it keeps the weekly mean.
  // (`targetsUseBodyFat` is the same test.)
  const schedule = normalizeTrainingSchedule(profile.training);
  if (!schedule?.enabled || !midnight) return base;

  const weekday = midnight.getDay();
  const classes = schedule.days.map(classifyTrainingDay);
  // A valid per-date override replaces only THIS day's session; the week's
  // scale, fat level and floors stay the template's.
  const plannedDay = schedule.days[weekday];
  const override = parseTrainingDay(ctx.overrideFor?.(date));
  const day = override ?? plannedDay;
  const dayClass = classifyTrainingDay(day);
  const setting = normalizeProteinSetting(profile.proteinSetting);
  const body = {
    weightKg: profile.weight,
    heightCm: profile.height,
    bodyFatPct: ctx.bodyFatPct,
  };
  const protein = proteinGrams(setting, body);
  const floors = {
    // Bodyweight, or the BMI > 30 protein weight without a body-fat
    // estimate: every per-kg floor follows the protein's weight.
    floorKg: protein.kg,
    meanKcal: values.targetCalories,
    goal: effective.goal,
    dietType: profile.dietType,
    explicitFatChoice: explicitFatChoice(profile),
  };
  // The smallest day that holds the protein and the fat + carb floors.
  const minDay = minDayKcal({ ...floors, proteinGrams: protein.grams });
  const weekInput = {
    meanKcal: values.targetCalories,
    classes,
    cycling: schedule.cycling,
    // The same per-day floor computeMacros applies, max(BMR, 1200), and no
    // day too small for the macro floors: cycling narrows its spread
    // instead. A mean under `minDay` leaves no room, so every day is the
    // mean.
    floorKcal: Math.max(values.bmr, MIN_DAILY_KCAL, minDay),
  };
  const weekKcal = distributeWeekCalories(weekInput);
  // An override of another class takes that class's day under the
  // TEMPLATE week's (narrowed) scale; the rest of the week is untouched (no
  // rebalancing), so its weekly sum legitimately differs from 7 × the mean
  // by this day's change. One of the planned day's own class keeps the
  // planned day's kcal (the week's rounding included).
  const dayKcal =
    override && dayClass !== classes[weekday]
      ? dayKcalForClass(weekInput, dayClass)
      : weekKcal[weekday];
  const week = {
    // The week's held fat (or carbs) is set on its smallest PLANNED day,
    // so every day of the week shares it; an override below it is the
    // week's smallest day only for its own split (`partitionDayMacros`).
    weekMinKcal: Math.min(...weekKcal),
    mean: values,
    proteinGrams: protein.grams,
    floorKg: floors.floorKg,
    goal: floors.goal,
    dietType: floors.dietType,
    explicitFatChoice: floors.explicitFatChoice,
  };
  const macros = partitionDayMacros({ ...week, dayKcal });
  return {
    ...base,
    targetCalories: dayKcal,
    ...macros,
    training: {
      day,
      plannedDay,
      overridden: override !== null,
      dayClass,
      cycling: schedule.cycling,
      meanCalories: values.targetCalories,
      proteinBasis: protein.basis,
      bodyFatWouldChangeProtein: protein.bodyFatWouldChangeProtein,
      floorsExceedMean:
        values.targetCalories < minDay &&
        floorsExceedMeanCause({ ...floors, setting, body }),
      requestedProtein:
        Math.round(protein.grams / MACRO_GRAM_STEP) * MACRO_GRAM_STEP,
      fatFloorLifted: fatFloorLiftsChoice(week),
    },
  };
}

/** A Monday-to-Sunday week of day targets — the training-week screen. */
export type WeekTargets = {
  /** The week's Monday (local `YYYY-MM-DD`). */
  weekStart: string;
  /** Monday → Sunday, each exactly what `targetsForDate` returns for it
   *  (with the context's overrides, if any). */
  days: DateTargets[];
  /** Sum of the seven `targetCalories`: 7 × the weekly mean for the template
   *  week (within the 50 kcal rounding). A per-date override changes only
   *  its own day — nothing is rebalanced — so a week with one differs from
   *  that by exactly the overridden days' changes. */
  totalCalories: number;
};

/** The seven day targets of the Monday-first week containing `anyDateInWeek`,
 *  or `null` for a key that isn't a calendar date. */
export function weekTargets(
  profile: PersonalInfo,
  anyDateInWeek: string,
  ctx: TargetContext,
): WeekTargets | null {
  const midnight = localMidnight(anyDateInWeek);
  if (!midnight) return null;
  const weekStart = addDays(anyDateInWeek, -((midnight.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) =>
    targetsForDate(profile, addDays(weekStart, i), ctx),
  );
  return {
    weekStart,
    days,
    totalCalories: days.reduce((sum, d) => sum + d.targetCalories, 0),
  };
}
