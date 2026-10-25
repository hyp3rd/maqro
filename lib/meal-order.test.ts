import { describe, expect, it } from "vitest";
import {
  orderDayMeals,
  USUAL_TIME_MIN_DAYS,
  usualMealMinutes,
} from "@maqro/core/meal-order";
import type { DailyLog } from "@maqro/core/records";
import { targetsForDate } from "@maqro/core/targets";
import type {
  FoodItem,
  Meal,
  PersonalInfo,
  TrainingDay,
} from "@maqro/core/types";
import {
  DEFAULT_WORKOUT_MEALS,
  dayMealsWithWorkout,
  workoutMealsForDay,
} from "@maqro/core/workout-meals";

const DATE = "2026-10-19"; // a Monday

/** 80 kg on a weekly template where only Monday trains, with `monday`. */
function plan(monday: TrainingDay) {
  const p: PersonalInfo = {
    gender: "male",
    age: 30,
    weight: 80,
    height: 180,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    manualTdee: 2600,
    units: "metric",
    training: {
      enabled: true,
      cycling: "modest",
      days: [
        { type: "rest" },
        monday,
        { type: "rest" },
        { type: "rest" },
        { type: "rest" },
        { type: "rest" },
        { type: "rest" },
      ],
    },
  };
  return workoutMealsForDay(
    targetsForDate(p, DATE, { phasesEnabled: false }),
    DEFAULT_WORKOUT_MEALS,
  );
}

const EVENING: TrainingDay = { type: "upper", time: "18:00", durationMin: 60 };

/** Local epoch of `hh:mm` on `date`. */
function at(date: string, hh: number, mm = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

function food(loggedAt?: number): FoodItem {
  return {
    id: 1,
    name: "Food",
    protein: 10,
    carbs: 10,
    fat: 5,
    calories: 125,
    portionSize: 100,
    ...(loggedAt === undefined ? {} : { loggedAt }),
  };
}

function regular(times: Partial<Record<number, number>> = {}): Meal[] {
  return [
    [1, "Breakfast"],
    [2, "Lunch"],
    [3, "Dinner"],
    [4, "Snacks"],
  ].map(([id, name]) => {
    const t = times[id as number];
    return {
      id: id as number,
      name: name as string,
      foods: t === undefined ? [] : [food(t)],
    };
  });
}

const names = (meals: Meal[]) => meals.map((m) => m.name);

describe("orderDayMeals", () => {
  it("an 18:00 session: after Lunch, around the session, before Dinner", () => {
    const p = plan(EVENING);
    const meals = dayMealsWithWorkout(regular(), p);
    // Pre aims at 16:30; Post at 19:30, level with the default Dinner.
    expect(
      names(orderDayMeals(meals, { date: DATE, usual: {}, plan: p })),
    ).toEqual([
      "Breakfast",
      "Lunch",
      "Pre-workout",
      "Post-workout",
      "Dinner",
      "Snacks",
    ]);
  });

  it("an early session: the snack before Breakfast, the meal after it", () => {
    const p = plan({ type: "fullBody", time: "07:00", durationMin: 60 });
    const meals = dayMealsWithWorkout(regular(), p);
    // Pre at 06:15, Post at 08:30 (Breakfast's default is 08:00).
    expect(
      names(orderDayMeals(meals, { date: DATE, usual: {}, plan: p })),
    ).toEqual([
      "Pre-workout",
      "Breakfast",
      "Post-workout",
      "Lunch",
      "Dinner",
      "Snacks",
    ]);
  });

  it("an untimed session: both just before Snacks", () => {
    const p = plan({ type: "upper" });
    const meals = dayMealsWithWorkout(regular(), p);
    expect(
      names(orderDayMeals(meals, { date: DATE, usual: {}, plan: p })),
    ).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Pre-workout",
      "Post-workout",
      "Snacks",
    ]);
  });

  it("today's logged times win over the usual ones, and usual over defaults", () => {
    const p = plan(EVENING);
    // A late lunch at 17:00 today: the pre-workout meal (16:30) comes first.
    const lateLunch = dayMealsWithWorkout(regular({ 2: at(DATE, 17) }), p);
    expect(
      names(
        orderDayMeals(lateLunch, {
          date: DATE,
          usual: { 2: 12 * 60 },
          plan: p,
        }),
      ),
    ).toEqual([
      "Breakfast",
      "Pre-workout",
      "Lunch",
      "Post-workout",
      "Dinner",
      "Snacks",
    ]);
    // Usually dinner at 18:30: it comes before the post-workout meal.
    const meals = dayMealsWithWorkout(regular(), p);
    expect(
      names(
        orderDayMeals(meals, {
          date: DATE,
          usual: { 3: 18 * 60 + 30 },
          plan: p,
        }),
      ),
    ).toEqual([
      "Breakfast",
      "Lunch",
      "Pre-workout",
      "Dinner",
      "Post-workout",
      "Snacks",
    ]);
  });

  it("a logged workout meal sits at its own time, and Post never before Pre", () => {
    const p = plan(EVENING);
    const meals = dayMealsWithWorkout(
      [
        ...regular(),
        // The pre-workout meal eaten late, at 20:00.
        {
          id: 5,
          name: "Pre-workout",
          role: "preWorkout",
          foods: [food(at(DATE, 20))],
        },
      ],
      p,
    );
    expect(
      names(orderDayMeals(meals, { date: DATE, usual: {}, plan: p })),
    ).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Pre-workout",
      "Post-workout",
      "Snacks",
    ]);
  });

  it("without workout meals the order is the stored one", () => {
    const meals = regular({ 1: at(DATE, 13), 2: at(DATE, 9) });
    expect(orderDayMeals(meals, { date: DATE, usual: {}, plan: null })).toEqual(
      meals,
    );
  });

  it("a workout meal kept for its food on a rest day sits by its logged time", () => {
    const meals: Meal[] = [
      ...regular(),
      {
        id: 6,
        name: "Post-workout",
        role: "postWorkout",
        foods: [food(at(DATE, 10))],
      },
    ];
    expect(
      names(orderDayMeals(meals, { date: DATE, usual: {}, plan: null })),
    ).toEqual(["Breakfast", "Post-workout", "Lunch", "Dinner", "Snacks"]);
  });
});

describe("usualMealMinutes", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

  function log(date: string, meals: Meal[]): DailyLog {
    return { date, meals, updatedAt: 0 };
  }

  it("the median first-logged minute of each regular meal", () => {
    const logs = days.map((date, i) =>
      log(date, regular({ 1: at(date, 7, i * 10), 3: at(date, 19 + (i % 2)) })),
    );
    // Breakfast 07:00, 07:10, 07:20, 07:30 → 07:15; Dinner 19, 20, 19, 20 → 19:30.
    expect(usualMealMinutes(logs)).toEqual({ 1: 7 * 60 + 15, 3: 19 * 60 + 30 });
  });

  it(`needs ${USUAL_TIME_MIN_DAYS} days with a logged time`, () => {
    const logs = days
      .slice(0, USUAL_TIME_MIN_DAYS - 1)
      .map((date) => log(date, regular({ 2: at(date, 13) })));
    expect(usualMealMinutes(logs)).toEqual({});
  });

  it("ignores untimed food, another day's times, Snacks and workout meals", () => {
    const logs = days.map((date) =>
      log(date, [
        // Planned (no time), and a time stamped on the next day.
        { id: 1, name: "Breakfast", foods: [food()] },
        { id: 2, name: "Lunch", foods: [food(at("2026-10-30", 12))] },
        { id: 3, name: "Dinner", foods: [] },
        { id: 4, name: "Snacks", foods: [food(at(date, 16))] },
        {
          id: 6,
          name: "Post-workout",
          role: "postWorkout",
          foods: [food(at(date, 19))],
        },
      ]),
    );
    expect(usualMealMinutes(logs)).toEqual({});
  });
});
