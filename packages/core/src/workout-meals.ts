import { DAY_MINUTES, parseClock } from "./clock";
import type { DateTargets } from "./targets";
import { MACRO_GRAM_STEP, normalizeTrainingSchedule } from "./training";
import type {
  Meal,
  TrainingDay,
  WorkoutMealRole,
  WorkoutMealSettings,
} from "./types";

/** A training day's workout meals: a pre-workout meal before the session and
 *  a post-workout meal after it, beside the four regular meals. Pure.
 *
 *  - They exist on a day with a session (the template's or the date's
 *    override), never on a rest day; the profile's `training.workoutMeals`
 *    turns either off, and a `fasted` session has no pre-workout meal.
 *  - Their aims are per kg of the weight the day's floors use
 *    (`TrainingDayTargets.floorKg`), carved OUT of the day's target — never
 *    calories on top of it. The regular meals split what is left.
 *  - Their timing follows the session's start and length.
 *  - In storage a workout meal exists only while it holds food; until then
 *    it is shown from the day's plan (`dayMealsWithWorkout`). */

export const PRE_WORKOUT_MEAL_ID = 5;
export const POST_WORKOUT_MEAL_ID = 6;

export const WORKOUT_MEAL_IDS: Record<WorkoutMealRole, number> = {
  preWorkout: PRE_WORKOUT_MEAL_ID,
  postWorkout: POST_WORKOUT_MEAL_ID,
};

export const WORKOUT_MEAL_NAMES: Record<WorkoutMealRole, string> = {
  preWorkout: "Pre-workout",
  postWorkout: "Post-workout",
};

/** Both meals on: what an absent `training.workoutMeals` means. */
export const DEFAULT_WORKOUT_MEALS: WorkoutMealSettings = {
  pre: true,
  post: true,
};

/** Protein per workout meal, g/kg (the per-meal dose that maximizes muscle
 *  protein synthesis is ~0.25–0.4 g/kg: the ISSN position stand on protein
 *  and exercise, 2017). */
export const WORKOUT_PROTEIN_G_PER_KG = 0.4;
/** Carbs per workout meal, g/kg, and on a heavy or long day. */
export const WORKOUT_CARBS_G_PER_KG = 0.5;
export const WORKOUT_CARBS_G_PER_KG_HEAVY = 1;
/** Fat aims: kept low before a session (slows digestion), moderate after. */
export const PRE_WORKOUT_FAT_G_PER_KG = 0.1;
export const POST_WORKOUT_FAT_G_PER_KG = 0.2;
/** A fasted session's post-workout meal brings at least this much protein. */
export const FASTED_POST_PROTEIN_MIN_G = 25;
/** A session longer than this (minutes) is "long": more carbs around it —
 *  where the carbohydrate guidance changes (Thomas et al. 2016). */
export const LONG_SESSION_MIN = 60;

/** The two workout meals together never take more than this share of the
 *  day's calories, nor more than `WORKOUT_MEALS_MAX_MACRO_SHARE` of any
 *  macro, so the regular meals keep a real share on a small or low-carb
 *  day. */
export const WORKOUT_MEALS_MAX_KCAL_SHARE = 0.35;
export const WORKOUT_MEALS_MAX_MACRO_SHARE = 0.5;

/** The pre-workout window: 1–3 h before the start, aiming at 90 min. */
export const PRE_WINDOW_FROM_MIN = 180;
export const PRE_WINDOW_TO_MIN = 60;
export const PRE_AIM_BEFORE_MIN = 90;
/** A session starting before this minute of the day is "early": a small,
 *  easy pre-workout snack 30–60 min before (half the aims), or fasted. */
export const EARLY_SESSION_BEFORE_MIN = 7 * 60 + 30;
export const EARLY_PRE_WINDOW_FROM_MIN = 60;
export const EARLY_PRE_WINDOW_TO_MIN = 30;
export const EARLY_PRE_AIM_BEFORE_MIN = 45;
export const EARLY_PRE_SCALE = 0.5;
/** The post-workout window: within 2 h of the end, aiming at 30 min. */
export const POST_WINDOW_MIN = 120;
export const POST_AIM_AFTER_MIN = 30;
/** A session without a planned length counts as this long. */
export const DEFAULT_SESSION_MIN = 60;

/** Grams of each macro and their kcal (4/4/9). */
export type MacroAims = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

/** A window of the day, minutes after local midnight (`end` may be 1440). */
export type DayWindow = { start: number; end: number };

/** One workout meal planned for a day. */
export type WorkoutMealSlot = {
  role: WorkoutMealRole;
  id: number;
  name: string;
  aims: MacroAims;
  /** When to eat it, or `null` when the session has no start time (or the
   *  window falls outside the day). */
  window: DayWindow | null;
  /** The minute the window aims at, inside it; `null` with no window. */
  aimMinute: number | null;
};

/** A training day's workout meals. */
export type WorkoutMealsPlan = {
  session: TrainingDay;
  /** A heavy or long session: the carbs are the heavy-day aims. */
  heavyOrLong: boolean;
  fasted: boolean;
  /** The session starts before `EARLY_SESSION_BEFORE_MIN`. */
  earlySession: boolean;
  pre: WorkoutMealSlot | null;
  post: WorkoutMealSlot | null;
};

/** The profile's workout-meal setting (`profile.training`), read like the
 *  rest of the template: anything unusable is the default (both on). */
export function workoutMealSettings(training: unknown): WorkoutMealSettings {
  return (
    normalizeTrainingSchedule(training)?.workoutMeals ?? DEFAULT_WORKOUT_MEALS
  );
}

/** Which workout meal `meal` is, or `null` for a regular meal: its `role`,
 *  else its name, else its reserved id — an older client may have dropped
 *  the role or renumbered the day's meals by position. */
export function workoutRole(
  meal: Pick<Meal, "id" | "name" | "role">,
): WorkoutMealRole | null {
  if (meal.role === "preWorkout" || meal.role === "postWorkout") {
    return meal.role;
  }
  const name = meal.name.trim().toLowerCase();
  for (const role of ["preWorkout", "postWorkout"] as const) {
    if (name === WORKOUT_MEAL_NAMES[role].toLowerCase()) return role;
  }
  if (meal.id === PRE_WORKOUT_MEAL_ID) return "preWorkout";
  if (meal.id === POST_WORKOUT_MEAL_ID) return "postWorkout";
  return null;
}

type Grams = Omit<MacroAims, "calories">;

const MACROS = ["protein", "carbs", "fat"] as const;

function kcalOf(g: Grams): number {
  return g.protein * 4 + g.carbs * 4 + g.fat * 9;
}

function sumGrams(list: readonly Grams[]): Grams {
  return list.reduce<Grams>(
    (acc, g) => ({
      protein: acc.protein + g.protein,
      carbs: acc.carbs + g.carbs,
      fat: acc.fat + g.fat,
    }),
    { protein: 0, carbs: 0, fat: 0 },
  );
}

/** Scale the raw aims into the day's caps: each macro to at most
 *  `WORKOUT_MEALS_MAX_MACRO_SHARE` of the day's, then all of them evenly to
 *  at most `WORKOUT_MEALS_MAX_KCAL_SHARE` of its kcal. */
function capToDay<T extends Grams>(raw: readonly T[], day: MacroAims): T[] {
  const total = sumGrams(raw);
  const scale = (m: (typeof MACROS)[number]) => {
    const limit = WORKOUT_MEALS_MAX_MACRO_SHARE * Math.max(day[m], 0);
    return total[m] > limit ? limit / total[m] : 1;
  };
  const macroScale = {
    protein: scale("protein"),
    carbs: scale("carbs"),
    fat: scale("fat"),
  };
  const scaled = raw.map((g) => ({
    ...g,
    protein: g.protein * macroScale.protein,
    carbs: g.carbs * macroScale.carbs,
    fat: g.fat * macroScale.fat,
  }));
  const kcal = kcalOf(sumGrams(scaled));
  const kcalLimit = WORKOUT_MEALS_MAX_KCAL_SHARE * Math.max(day.calories, 0);
  const k = kcal > kcalLimit ? kcalLimit / kcal : 1;
  return scaled.map((g) => ({
    ...g,
    protein: g.protein * k,
    carbs: g.carbs * k,
    fat: g.fat * k,
  }));
}

/** An aim on the macro grid (nearest 5 g). The caps hold before this
 *  rounding, which moves each aim by at most 2.5 g — never worth rounding a
 *  meal's protein down for. */
function onGrid(grams: number): number {
  return Math.max(0, Math.round(grams / MACRO_GRAM_STEP) * MACRO_GRAM_STEP);
}

/** The pre-workout window for a session starting at `start`, clipped to the
 *  day; `null` when nothing of it is left (a session just after midnight). */
function preWindow(
  start: number,
  early: boolean,
): { window: DayWindow; aim: number } | null {
  const from = early ? EARLY_PRE_WINDOW_FROM_MIN : PRE_WINDOW_FROM_MIN;
  const to = early ? EARLY_PRE_WINDOW_TO_MIN : PRE_WINDOW_TO_MIN;
  const before = early ? EARLY_PRE_AIM_BEFORE_MIN : PRE_AIM_BEFORE_MIN;
  const window = { start: Math.max(start - from, 0), end: start - to };
  if (window.end <= window.start) return null;
  const aim = Math.min(Math.max(start - before, window.start), window.end);
  return { window, aim };
}

/** The post-workout window after a session ending at `end`, clipped to the
 *  day; `null` when the session ends at or after midnight (its meal belongs
 *  to the next day). */
function postWindow(end: number): { window: DayWindow; aim: number } | null {
  if (end >= DAY_MINUTES) return null;
  const window = {
    start: end,
    end: Math.min(end + POST_WINDOW_MIN, DAY_MINUTES),
  };
  return { window, aim: Math.min(end + POST_AIM_AFTER_MIN, window.end) };
}

/** The day's workout meals, or `null` for a day without them: no training
 *  schedule, a rest day, or both meals off (or off and fasted). `day` is
 *  what `targetsForDate` resolved for the date; `settings` the profile's
 *  `workoutMealSettings`. */
export function workoutMealsForDay(
  day: DateTargets,
  settings: WorkoutMealSettings,
): WorkoutMealsPlan | null {
  const training = day.training;
  if (!training || training.day.type === "rest") return null;
  const session = training.day;
  const fasted = session.fasted === true;
  const roles: WorkoutMealRole[] = [];
  if (settings.pre && !fasted) roles.push("preWorkout");
  if (settings.post) roles.push("postWorkout");
  if (roles.length === 0) return null;

  const kg = training.floorKg;
  const minutes = session.durationMin;
  const heavyOrLong =
    training.dayClass === "heavy" ||
    training.dayClass === "endurance" ||
    (minutes ?? 0) > LONG_SESSION_MIN;
  const carbsPerKg = heavyOrLong
    ? WORKOUT_CARBS_G_PER_KG_HEAVY
    : WORKOUT_CARBS_G_PER_KG;
  const start = parseClock(session.time);
  const earlySession = start !== null && start < EARLY_SESSION_BEFORE_MIN;

  const raw = roles.map((role) => {
    if (role === "preWorkout") {
      const scale = earlySession ? EARLY_PRE_SCALE : 1;
      return {
        role,
        protein: WORKOUT_PROTEIN_G_PER_KG * kg * scale,
        carbs: carbsPerKg * kg * scale,
        fat: PRE_WORKOUT_FAT_G_PER_KG * kg * scale,
      };
    }
    return {
      role,
      protein: Math.max(
        WORKOUT_PROTEIN_G_PER_KG * kg,
        fasted ? FASTED_POST_PROTEIN_MIN_G : 0,
      ),
      carbs: carbsPerKg * kg,
      fat: POST_WORKOUT_FAT_G_PER_KG * kg,
    };
  });
  const dayAims: MacroAims = {
    protein: day.protein,
    carbs: day.carbs,
    fat: day.fat,
    calories: day.targetCalories,
  };

  const end = start === null ? null : start + (minutes ?? DEFAULT_SESSION_MIN);
  const slots = capToDay(raw, dayAims).map((capped): WorkoutMealSlot => {
    const { role } = capped;
    const grams = {
      protein: onGrid(capped.protein),
      carbs: onGrid(capped.carbs),
      fat: onGrid(capped.fat),
    };
    const timing =
      start === null || end === null
        ? null
        : role === "preWorkout"
          ? preWindow(start, earlySession)
          : postWindow(end);
    return {
      role,
      id: WORKOUT_MEAL_IDS[role],
      name: WORKOUT_MEAL_NAMES[role],
      aims: { ...grams, calories: kcalOf(grams) },
      window: timing?.window ?? null,
      aimMinute: timing?.aim ?? null,
    };
  });
  return {
    session,
    heavyOrLong,
    fasted,
    earlySession,
    pre: slots.find((s) => s.role === "preWorkout") ?? null,
    post: slots.find((s) => s.role === "postWorkout") ?? null,
  };
}

function planned(
  plan: WorkoutMealsPlan | null,
  role: WorkoutMealRole,
): WorkoutMealSlot | null {
  if (!plan) return null;
  return role === "preWorkout" ? plan.pre : plan.post;
}

/** The empty meal a workout slot starts as. */
function emptyWorkoutMeal(meals: readonly Meal[], role: WorkoutMealRole): Meal {
  const taken = new Set(meals.map((m) => m.id));
  const reserved = WORKOUT_MEAL_IDS[role];
  const id = taken.has(reserved)
    ? Math.max(POST_WORKOUT_MEAL_ID, ...taken) + 1
    : reserved;
  return { id, name: WORKOUT_MEAL_NAMES[role], role, foods: [] };
}

/** The day's meals as shown: the stored meals, minus an EMPTY workout meal
 *  the day no longer plans (it flipped to rest, or the meal was turned off),
 *  plus each planned workout meal the day doesn't store yet (empty, from
 *  the plan). A workout meal with food always stays. Storage order is kept;
 *  `orderDayMeals` sorts for display. */
export function dayMealsWithWorkout(
  stored: readonly Meal[],
  plan: WorkoutMealsPlan | null,
): Meal[] {
  const out = stored.filter((m) => {
    const role = workoutRole(m);
    return role === null || m.foods.length > 0 || planned(plan, role) !== null;
  });
  for (const role of ["preWorkout", "postWorkout"] as const) {
    if (planned(plan, role) === null) continue;
    if (out.some((m) => workoutRole(m) === role)) continue;
    out.push(emptyWorkoutMeal(out, role));
  }
  return out;
}

/** The stored meals to write, with the `role` workout meal present (added
 *  empty when missing, so a first food can go into it), and every meal
 *  kept in id order — the order an older client renumbers by. */
export function withWorkoutMeal(
  stored: readonly Meal[],
  role: WorkoutMealRole,
): Meal[] {
  if (stored.some((m) => workoutRole(m) === role)) return [...stored];
  return [...stored, emptyWorkoutMeal(stored, role)].sort(
    (a, b) => a.id - b.id,
  );
}

/** The stored meals to write, without workout meals that hold no food: in
 *  storage a workout meal exists only while it has food. */
export function withoutEmptyWorkoutMeals(stored: readonly Meal[]): Meal[] {
  return stored.filter((m) => workoutRole(m) === null || m.foods.length > 0);
}

/** How the day's target splits across the four regular meals. */
export const REGULAR_MEAL_SHARES: Readonly<Record<number, number>> = {
  1: 0.25, // Breakfast
  2: 0.35, // Lunch
  3: 0.3, // Dinner
  4: 0.1, // Snacks
};

/** Each meal's share of the day's target, by meal id. A workout meal the day
 *  plans takes its aims (one it doesn't plan, e.g. one kept for its food on
 *  a rest day, takes nothing); the regular meals split what is left by
 *  `REGULAR_MEAL_SHARES`, normalized over the meals present (a meal of
 *  another id counts as an average one), so the meals always add up to the
 *  day. */
export function mealTargetsForDay(
  meals: readonly Meal[],
  day: MacroAims,
  plan: WorkoutMealsPlan | null,
): Map<number, MacroAims> {
  const out = new Map<number, MacroAims>();
  const zero: MacroAims = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  const left = { ...day };
  const regular: Meal[] = [];
  for (const meal of meals) {
    const role = workoutRole(meal);
    if (role === null) {
      regular.push(meal);
      continue;
    }
    const slot = planned(plan, role);
    out.set(meal.id, slot ? slot.aims : zero);
    if (slot) {
      for (const k of [...MACROS, "calories"] as const) left[k] -= slot.aims[k];
    }
  }
  const averageShare = 1 / Object.keys(REGULAR_MEAL_SHARES).length;
  const shares = regular.map((m) => REGULAR_MEAL_SHARES[m.id] ?? averageShare);
  const total = shares.reduce((a, b) => a + b, 0);
  regular.forEach((meal, i) => {
    const share = total > 0 ? shares[i] / total : 0;
    out.set(meal.id, {
      protein: Math.max(left.protein, 0) * share,
      carbs: Math.max(left.carbs, 0) * share,
      fat: Math.max(left.fat, 0) * share,
      calories: Math.max(left.calories, 0) * share,
    });
  });
  return out;
}
