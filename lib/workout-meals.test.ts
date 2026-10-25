import { describe, expect, it } from "vitest";
import { type DateTargets, targetsForDate } from "@maqro/core/targets";
import type {
  Meal,
  PersonalInfo,
  TrainingDay,
  TrainingWeek,
} from "@maqro/core/types";
import {
  DEFAULT_WORKOUT_MEALS,
  dayMealsWithWorkout,
  mealTargetsForDay,
  WORKOUT_MEALS_MAX_KCAL_SHARE,
  WORKOUT_MEALS_MAX_MACRO_SHARE,
  withoutEmptyWorkoutMeals,
  withWorkoutMeal,
  workoutMealAt,
  workoutMealSettings,
  workoutMealsForDay,
  workoutRole,
} from "@maqro/core/workout-meals";

/** The targets tests' mockup week (indexed by `getDay()`): Mon upper
 *  moderate 18:00 for 60 min, Wed lower hard 18:00 for 75, Fri full body
 *  07:00 for 60, Sat endurance 09:00 for 90; rest otherwise. */
const WEEK: TrainingWeek = [
  { type: "rest" },
  { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
  { type: "rest" },
  { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
  { type: "rest" },
  { type: "fullBody", intensity: "moderate", time: "07:00", durationMin: 60 },
  { type: "endurance", intensity: "moderate", time: "09:00", durationMin: 90 },
];

const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";
const FRI = "2026-10-23";
const SAT = "2026-10-24";

/** 80 kg / 180 cm / 30 y male cutting 0.4 kg/week from 2,640 kcal: a 2,200
 *  weekly mean (Mon 2,250, Wed and Sat 2,450, 160 g protein, 85 g fat). */
function profile(over: Partial<PersonalInfo> = {}): PersonalInfo {
  return {
    gender: "male",
    age: 30,
    weight: 80,
    height: 180,
    activityLevel: "moderate",
    goal: "lose",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0.4,
    manualTdee: 2640,
    units: "metric",
    training: { enabled: true, days: WEEK, cycling: "modest" },
    ...over,
  };
}

const FREE = { phasesEnabled: false };

function day(date: string, over: Partial<PersonalInfo> = {}): DateTargets {
  return targetsForDate(profile(over), date, FREE);
}

/** `date`'s targets with one session swapped in (a per-date override). */
function withSession(date: string, session: TrainingDay): DateTargets {
  return targetsForDate(profile(), date, {
    ...FREE,
    overrideFor: (d) => (d === date ? session : undefined),
  });
}

function plan(t: DateTargets, settings = DEFAULT_WORKOUT_MEALS) {
  const p = workoutMealsForDay(t, settings);
  if (!p) throw new Error("expected workout meals");
  return p;
}

const REGULAR: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

const SHAKE = {
  id: 1,
  name: "Protein shake",
  protein: 25,
  carbs: 5,
  fat: 2,
  calories: 138,
  portionSize: 300,
};

describe("workoutRole", () => {
  it("reads the role, else the name, else the reserved id", () => {
    expect(workoutRole({ id: 9, name: "Anything", role: "postWorkout" })).toBe(
      "postWorkout",
    );
    // An older client dropped the role or renumbered the day by position.
    expect(workoutRole({ id: 5, name: " post-WORKOUT " })).toBe("postWorkout");
    expect(workoutRole({ id: 6, name: "Pre-workout" })).toBe("preWorkout");
    expect(workoutRole({ id: 5, name: "" })).toBe("preWorkout");
    expect(workoutRole({ id: 6, name: "" })).toBe("postWorkout");
  });

  it("a regular meal is none", () => {
    for (const m of REGULAR) expect(workoutRole(m)).toBeNull();
  });
});

describe("workoutMealSettings", () => {
  it("both on unless the stored setting turns one off", () => {
    expect(workoutMealSettings(undefined)).toEqual({ pre: true, post: true });
    expect(workoutMealSettings(profile().training)).toEqual({
      pre: true,
      post: true,
    });
    expect(
      workoutMealSettings({
        ...profile().training,
        workoutMeals: { pre: false },
      }),
    ).toEqual({ pre: false, post: true });
    // Anything but a literal false stays on.
    expect(
      workoutMealSettings({
        ...profile().training,
        workoutMeals: { pre: "no", post: 0 },
      }),
    ).toEqual({ pre: true, post: true });
    expect(
      workoutMealSettings({ ...profile().training, workoutMeals: "off" }),
    ).toEqual({ pre: true, post: true });
  });
});

describe("workoutMealsForDay", () => {
  it("a moderate 18:00 hour: 0.4 g/kg protein, 0.5 g/kg carbs, low fat, within 35% of the day", () => {
    const t = day(MON);
    expect([t.targetCalories, t.protein, t.carbs, t.fat]).toEqual([
      2250, 160, 210, 85,
    ]);
    const p = plan(t);
    expect(p.heavyOrLong).toBe(false);
    expect(p.earlySession).toBe(false);
    expect(p.fasted).toBe(false);
    // Raw 32/40/8 and 32/40/16 g (792 kcal) scaled into 35% of 2,250
    // (787.5), then on the 5 g grid.
    expect(p.pre).toEqual({
      role: "preWorkout",
      id: 5,
      name: "Pre-workout",
      aims: { protein: 30, carbs: 40, fat: 10, calories: 370 },
      window: { start: 15 * 60, end: 17 * 60 },
      aimMinute: 16 * 60 + 30,
    });
    expect(p.post).toEqual({
      role: "postWorkout",
      id: 6,
      name: "Post-workout",
      aims: { protein: 30, carbs: 40, fat: 15, calories: 415 },
      window: { start: 19 * 60, end: 21 * 60 },
      aimMinute: 19 * 60 + 30,
    });
  });

  it("a heavy day: 1 g/kg carbs, capped at half the day's carbs and 35% of its kcal", () => {
    const t = day(WED);
    expect([t.targetCalories, t.protein, t.carbs, t.fat]).toEqual([
      2450, 160, 260, 85,
    ]);
    const p = plan(t);
    expect(p.heavyOrLong).toBe(true);
    // Raw carbs 2 × 80 g → 130 (half of 260), then everything × 857.5/992.
    expect(p.pre?.aims).toEqual({
      protein: 30,
      carbs: 55,
      fat: 5,
      calories: 385,
    });
    expect(p.post?.aims).toEqual({
      protein: 30,
      carbs: 55,
      fat: 15,
      calories: 475,
    });
  });

  it("a long session counts as heavy whatever its class", () => {
    // A moderate upper-body session of 75 min is a `training` day.
    const t = withSession(MON, {
      type: "upper",
      intensity: "moderate",
      time: "18:00",
      durationMin: 75,
    });
    expect(t.training?.dayClass).toBe("training");
    expect(plan(t).heavyOrLong).toBe(true);
    expect(plan(day(MON)).heavyOrLong).toBe(false); // exactly 60 min
  });

  it("long endurance: 07:30 before a 09:00 start, post within 2 h of 10:30", () => {
    const p = plan(day(SAT));
    expect(p.heavyOrLong).toBe(true);
    expect(p.pre?.window).toEqual({ start: 6 * 60, end: 8 * 60 });
    expect(p.pre?.aimMinute).toBe(7 * 60 + 30);
    expect(p.post?.window).toEqual({ start: 10 * 60 + 30, end: 12 * 60 + 30 });
    expect(p.post?.aimMinute).toBe(11 * 60);
  });

  it("an early session: a small snack 30–60 min before, at half the aims", () => {
    const p = plan(day(FRI));
    expect(p.earlySession).toBe(true);
    expect(p.pre?.window).toEqual({ start: 6 * 60, end: 6 * 60 + 30 });
    expect(p.pre?.aimMinute).toBe(6 * 60 + 15);
    expect(p.pre?.aims).toEqual({
      protein: 15,
      carbs: 20,
      fat: 5,
      calories: 185,
    });
    expect(p.post?.aims).toEqual({
      protein: 30,
      carbs: 40,
      fat: 15,
      calories: 415,
    });
    expect(p.post?.aimMinute).toBe(8 * 60 + 30);
  });

  it("a session without a start time has untimed meals", () => {
    const p = plan(withSession(MON, { type: "upper", intensity: "moderate" }));
    expect(p.pre?.window).toBeNull();
    expect(p.pre?.aimMinute).toBeNull();
    expect(p.post?.window).toBeNull();
    expect(p.pre?.aims.protein).toBe(30);
  });

  it("windows stay inside the day", () => {
    // 00:30: nothing of the 1–3 h before is left in the day.
    const night = plan(withSession(MON, { type: "upper", time: "00:30" }));
    expect(night.pre?.window).toBeNull();
    expect(night.post?.window).toEqual({ start: 90, end: 210 });
    // Ending after midnight: the post-workout meal is tomorrow's.
    const late = plan(
      withSession(MON, { type: "endurance", time: "23:00", durationMin: 90 }),
    );
    expect(late.pre?.window).toEqual({ start: 20 * 60, end: 22 * 60 });
    expect(late.post?.window).toBeNull();
    // Ending late: the window stops at midnight.
    const evening = plan(withSession(MON, { type: "upper", time: "22:00" }));
    expect(evening.post?.window).toEqual({ start: 23 * 60, end: 24 * 60 });
    expect(evening.post?.aimMinute).toBe(23 * 60 + 30);
  });

  it("fasted: no pre-workout meal, and at least 25 g protein after", () => {
    const fasted: TrainingDay = { ...WEEK[1], fasted: true };
    const p = plan(withSession(MON, fasted));
    expect(p.fasted).toBe(true);
    expect(p.pre).toBeNull();
    expect(p.post?.aims.protein).toBe(30); // 0.4 × 80 = 32 already above
    // A 50 kg lifter's 0.4 g/kg is 20 g: the floor lifts it to 25.
    const light = targetsForDate(profile({ weight: 50, height: 165 }), MON, {
      ...FREE,
      overrideFor: (d) => (d === MON ? fasted : undefined),
    });
    expect(light.training?.floorKg).toBe(50);
    expect(plan(light).post?.aims.protein).toBe(25);
  });

  it("the setting turns each meal off", () => {
    const t = day(MON);
    const postOnly = plan(t, { pre: false, post: true });
    expect(postOnly.pre).toBeNull();
    expect(postOnly.post?.aims.protein).toBe(30);
    expect(plan(t, { pre: true, post: false }).post).toBeNull();
    expect(workoutMealsForDay(t, { pre: false, post: false })).toBeNull();
    // Fasted with post off leaves nothing.
    expect(
      workoutMealsForDay(withSession(MON, { ...WEEK[1], fasted: true }), {
        pre: true,
        post: false,
      }),
    ).toBeNull();
  });

  it("no workout meals on a rest day or without a training schedule", () => {
    expect(workoutMealsForDay(day(TUE), DEFAULT_WORKOUT_MEALS)).toBeNull();
    expect(
      workoutMealsForDay(
        day(MON, { training: undefined }),
        DEFAULT_WORKOUT_MEALS,
      ),
    ).toBeNull();
    expect(
      workoutMealsForDay(
        day(MON, {
          training: { enabled: false, days: WEEK, cycling: "modest" },
        }),
        DEFAULT_WORKOUT_MEALS,
      ),
    ).toBeNull();
  });

  it("a small day: the meals scale into its caps", () => {
    const t: DateTargets = {
      ...day(MON),
      targetCalories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    };
    // Protein 64 → 60 and carbs 80 → 75 (half the day's), then × 525/756.
    const p = plan(t);
    expect(p.pre?.aims).toEqual({
      protein: 20,
      carbs: 25,
      fat: 5,
      calories: 225,
    });
    expect(p.post?.aims).toEqual({
      protein: 20,
      carbs: 25,
      fat: 10,
      calories: 270,
    });
  });

  it("caps hold within the 5 g rounding across days and weights", () => {
    const step = 2.5; // the most rounding moves one aim
    for (const weight of [45, 60, 80, 110, 140]) {
      for (const date of [MON, WED, FRI, SAT]) {
        for (const carbs of [20, 60, 260]) {
          const t: DateTargets = {
            ...day(date, { weight, height: 175 }),
            carbs,
          };
          const p = plan(t);
          const meals = [p.pre, p.post].flatMap((s) => (s ? [s.aims] : []));
          const sum = (k: "protein" | "carbs" | "fat" | "calories") =>
            meals.reduce((a, m) => a + m[k], 0);
          const slack = meals.length * step;
          expect(sum("carbs")).toBeLessThanOrEqual(
            WORKOUT_MEALS_MAX_MACRO_SHARE * t.carbs + slack,
          );
          expect(sum("protein")).toBeLessThanOrEqual(
            WORKOUT_MEALS_MAX_MACRO_SHARE * t.protein + slack,
          );
          expect(sum("calories")).toBeLessThanOrEqual(
            WORKOUT_MEALS_MAX_KCAL_SHARE * t.targetCalories +
              meals.length * step * (4 + 4 + 9),
          );
          for (const m of meals) {
            expect(m.calories).toBe(m.protein * 4 + m.carbs * 4 + m.fat * 9);
            for (const g of [m.protein, m.carbs, m.fat]) {
              expect(g % 5).toBe(0);
              expect(g).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });
});

describe("dayMealsWithWorkout", () => {
  const monday = plan(day(MON));

  it("adds the planned workout meals the day doesn't store yet, empty", () => {
    expect(dayMealsWithWorkout(REGULAR, monday)).toEqual([
      ...REGULAR,
      { id: 5, name: "Pre-workout", role: "preWorkout", foods: [] },
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [] },
    ]);
  });

  it("never duplicates a stored one, even without its role", () => {
    const stored = [
      ...REGULAR,
      { id: 5, name: "Post-workout", foods: [SHAKE] }, // renumbered, role lost
    ];
    const shown = dayMealsWithWorkout(stored, monday);
    expect(shown.filter((m) => workoutRole(m) === "postWorkout")).toHaveLength(
      1,
    );
    // The pre-workout meal can't take id 5: the next free id.
    expect(shown.find((m) => workoutRole(m) === "preWorkout")?.id).toBe(7);
  });

  it("a workout meal with food stays on a rest day; an empty one goes", () => {
    const stored: Meal[] = [
      ...REGULAR,
      { id: 5, name: "Pre-workout", role: "preWorkout", foods: [] },
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    expect(dayMealsWithWorkout(stored, null)).toEqual([...REGULAR, stored[5]]);
  });

  it("follows the setting and a fasted session", () => {
    const postOnly = plan(day(MON), { pre: false, post: true });
    expect(dayMealsWithWorkout(REGULAR, postOnly).map((m) => m.id)).toEqual([
      1, 2, 3, 4, 6,
    ]);
    const fasted = plan(withSession(MON, { ...WEEK[1], fasted: true }));
    expect(dayMealsWithWorkout(REGULAR, fasted).map((m) => m.id)).toEqual([
      1, 2, 3, 4, 6,
    ]);
  });
});

describe("withWorkoutMeal / withoutEmptyWorkoutMeals", () => {
  it("adds the meal empty, in id order, for its first food", () => {
    const stored = [...REGULAR, { id: 6, name: "Post-workout", foods: [] }];
    expect(withWorkoutMeal(stored, "preWorkout").map((m) => m.id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(withWorkoutMeal(stored, "postWorkout")).toEqual(stored);
    expect(withWorkoutMeal(stored, "postWorkout")).not.toBe(stored);
  });

  it("keeps workout meals only while they hold food", () => {
    const stored: Meal[] = [
      ...REGULAR,
      { id: 5, name: "Pre-workout", role: "preWorkout", foods: [] },
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    // Empty regular meals always stay.
    expect(withoutEmptyWorkoutMeals(stored).map((m) => m.id)).toEqual([
      1, 2, 3, 4, 6,
    ]);
  });

  it("writes the day as shown back in id order", () => {
    const shown: Meal[] = [
      REGULAR[0],
      REGULAR[1],
      { id: 5, name: "Pre-workout", role: "preWorkout", foods: [SHAKE] },
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [] },
      REGULAR[2],
      REGULAR[3],
    ];
    expect(withoutEmptyWorkoutMeals(shown).map((m) => m.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // Never the caller's array.
    expect(shown.map((m) => m.id)).toEqual([1, 2, 5, 6, 3, 4]);
  });
});

describe("workoutMealAt", () => {
  const monday = plan(day(MON)); // pre 15:00–17:00, post 19:00–21:00

  it("the meal whose window holds the minute", () => {
    expect(workoutMealAt(monday, 15 * 60)?.role).toBe("preWorkout");
    expect(workoutMealAt(monday, 16 * 60 + 59)?.role).toBe("preWorkout");
    expect(workoutMealAt(monday, 20 * 60)?.role).toBe("postWorkout");
  });

  it("none between, outside, untimed or without a plan", () => {
    expect(workoutMealAt(monday, 17 * 60)).toBeNull(); // end is exclusive
    expect(workoutMealAt(monday, 18 * 60)).toBeNull();
    expect(workoutMealAt(monday, 8 * 60)).toBeNull();
    const untimed = plan(withSession(MON, { type: "upper" }));
    expect(workoutMealAt(untimed, 16 * 60)).toBeNull();
    expect(workoutMealAt(null, 16 * 60)).toBeNull();
  });
});

describe("mealTargetsForDay", () => {
  const t = day(MON);
  const dayAims = {
    protein: t.protein,
    carbs: t.carbs,
    fat: t.fat,
    calories: t.targetCalories,
  };

  function total(targets: Map<number, typeof dayAims>) {
    const out = { protein: 0, carbs: 0, fat: 0, calories: 0 };
    for (const v of targets.values()) {
      out.protein += v.protein;
      out.carbs += v.carbs;
      out.fat += v.fat;
      out.calories += v.calories;
    }
    return out;
  }

  it("without workout meals: 25 / 35 / 30 / 10 of the day", () => {
    const targets = mealTargetsForDay(REGULAR, dayAims, null);
    expect(targets.get(1)?.calories).toBeCloseTo(0.25 * 2250);
    expect(targets.get(2)?.calories).toBeCloseTo(0.35 * 2250);
    expect(targets.get(3)?.calories).toBeCloseTo(0.3 * 2250);
    expect(targets.get(4)?.calories).toBeCloseTo(0.1 * 2250);
  });

  it("workout meals take their aims; the regular meals share the rest", () => {
    const p = plan(t);
    const meals = dayMealsWithWorkout(REGULAR, p);
    const targets = mealTargetsForDay(meals, dayAims, p);
    expect(targets.get(5)).toEqual(p.pre?.aims);
    expect(targets.get(6)).toEqual(p.post?.aims);
    // 2,250 − 370 − 415 = 1,465 kcal left; Lunch keeps its 35%.
    expect(targets.get(2)?.calories).toBeCloseTo(0.35 * 1465);
    expect(targets.get(2)?.protein).toBeCloseTo(0.35 * (160 - 60));
    const sum = total(targets);
    for (const k of ["protein", "carbs", "fat", "calories"] as const) {
      expect(sum[k]).toBeCloseTo(dayAims[k]);
    }
  });

  it("a workout meal the day doesn't plan takes nothing", () => {
    const meals: Meal[] = [
      ...REGULAR,
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    const targets = mealTargetsForDay(meals, dayAims, null);
    expect(targets.get(6)).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
    });
    expect(total(targets).calories).toBeCloseTo(2250);
  });

  it("the shares always add up to the day, whichever meals are present", () => {
    const lone = mealTargetsForDay([REGULAR[0]], dayAims, null);
    expect(lone.get(1)).toEqual(dayAims);
    const odd = mealTargetsForDay(
      [...REGULAR, { id: 9, name: "Supper", foods: [] }],
      dayAims,
      null,
    );
    expect(total(odd).calories).toBeCloseTo(2250);
    // An unknown meal counts as an average one (0.25 of 1.25).
    expect(odd.get(9)?.calories).toBeCloseTo((0.25 / 1.25) * 2250);
  });
});
