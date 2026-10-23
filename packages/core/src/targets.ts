import { addDays } from "./date";
import { effectiveGoal } from "./goal-phases";
import { computeMacros } from "./macros";
import {
  type ProteinBasis,
  type TrainingDayClass,
  classifyTrainingDay,
  distributeWeekCalories,
  explicitFatChoice,
  fatFloorLiftsChoice,
  minDayKcal,
  normalizeProteinSetting,
  normalizeTrainingSchedule,
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
 *  template (training.ts). Pure: the date, the tier decision and any
 *  body-fat estimate are inputs, never read from the environment, so it runs
 *  identically on web, server and native. */

/** What the caller has resolved about the user before asking for a target.
 *  Gating lives in callers (see goal-phases.ts): pass `phasesEnabled: true`
 *  only after the tier check (`FEATURES.canUseGoalPhases`). `bodyFatPct` is
 *  the latest body-fat estimate (%) if the caller has one — the training
 *  protein reads it (`proteinGrams`): absent, a lean-mass setting takes the
 *  2.0 g/kg bodyweight default, and at BMI ≥ 30 g/kg is taken on the BMI-25
 *  reference weight. */
export type TargetContext = {
  phasesEnabled: boolean;
  bodyFatPct?: number | null;
};

/** What drove a training-day target (present only while a schedule is on). */
export type TrainingDayTargets = {
  /** The template entry for this weekday. */
  day: TrainingDay;
  dayClass: TrainingDayClass;
  cycling: CyclingPreset;
  /** The weekly mean daily target the day is planned around. */
  meanCalories: number;
  /** The protein basis actually used (`proteinGrams`): a lean-mass setting
   *  without a body-fat estimate falls back to the 2.0 g/kg bodyweight
   *  default, so `bodyweight` under a `leanMass` setting means "add a
   *  body-fat estimate to use lean mass"; `referenceWeight` (BMI ≥ 30, no
   *  estimate) means g/kg was taken on the BMI-25 weight for the height —
   *  also a prompt for a body-fat estimate. */
  proteinBasis: ProteinBasis;
  /** Even the weekly-average day can't hold the protein setting, the fat
   *  floor and the 1 g/kg carb floor together (`minDayKcal`) — the UI can
   *  gently suggest a smaller deficit. Every day then sits at the mean, and
   *  the floors give way in `proteinCeilingGrams`' order: the fat floor
   *  holds, then protein ≥ 1.2 g/kg, then carbs ≥ 1 g/kg, then the rest of
   *  the protein. When false, every planned day holds all of them: cycling
   *  narrows its spread rather than plan a day that can't. */
  floorsExceedMean: boolean;
  /** The fat floor lifted the user's explicit fat choice (a `lowFat` diet
   *  type or a custom macro split asking for less than max(15% of the mean
   *  kcal, 0.5 g/kg)), so fat is held at the floor — the UI's info note
   *  (`fatFloorLiftsChoice`). */
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
  const schedule = normalizeTrainingSchedule(profile.training);
  if (!schedule?.enabled || !midnight) return base;

  const weekday = midnight.getDay();
  const classes = schedule.days.map(classifyTrainingDay);
  const dayClass = classes[weekday];
  const protein = proteinGrams(
    normalizeProteinSetting(profile.proteinSetting),
    {
      weightKg: profile.weight,
      heightCm: profile.height,
      bodyFatPct: ctx.bodyFatPct,
    },
  );
  const floors = {
    weightKg: profile.weight,
    proteinKg: protein.kg,
    meanKcal: values.targetCalories,
    goal: effective.goal,
    dietType: profile.dietType,
    explicitFatChoice: explicitFatChoice(profile),
  };
  // The smallest day that holds the protein and the fat + carb floors.
  const minDay = minDayKcal({ ...floors, proteinGrams: protein.grams });
  const weekKcal = distributeWeekCalories({
    meanKcal: values.targetCalories,
    classes,
    cycling: schedule.cycling,
    // The same per-day floor computeMacros applies, max(BMR, 1200), and no
    // day too small for the macro floors: cycling narrows its spread
    // instead. A mean under `minDay` leaves no room, so every day is the
    // mean.
    floorKcal: Math.max(values.bmr, MIN_DAILY_KCAL, minDay),
  });
  const dayKcal = weekKcal[weekday];
  const macros = partitionDayMacros({
    dayKcal,
    mean: values,
    proteinGrams: protein.grams,
    weightKg: floors.weightKg,
    proteinKg: floors.proteinKg,
    goal: floors.goal,
    dietType: floors.dietType,
    explicitFatChoice: floors.explicitFatChoice,
  });
  return {
    ...base,
    targetCalories: dayKcal,
    ...macros,
    training: {
      day: schedule.days[weekday],
      dayClass,
      cycling: schedule.cycling,
      meanCalories: values.targetCalories,
      proteinBasis: protein.basis,
      floorsExceedMean: values.targetCalories < minDay,
      fatFloorLifted: fatFloorLiftsChoice({ ...floors, meanFat: values.fat }),
    },
  };
}

/** A Monday-to-Sunday week of day targets — the training-week screen. */
export type WeekTargets = {
  /** The week's Monday (local `YYYY-MM-DD`). */
  weekStart: string;
  /** Monday → Sunday, each exactly what `targetsForDate` returns for it. */
  days: DateTargets[];
  /** Sum of the seven `targetCalories`. */
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
