import type {
  DietPreference,
  Food,
  FoodItem,
  Meal,
} from "@/components/macro/types";
import { filterByDiet } from "@/lib/diet";

/** Lower bound for solid foods. Fat-dominant foods (oils, butters) override
 * this with a smaller minimum since 10g of olive oil is a real portion. */
const PORTION_GRAMS_MIN_SOLID = 25;
const PORTION_GRAMS_MIN_FAT = 5;
const PORTION_GRAMS_MAX = 400;
const PORTION_SNAP_GRAMS = 5;
const MAX_TRIPLET_TRIES = 60;
const VEGETABLE_GRAMS = 100;

export type PlannedTotals = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

export type MealTargets = PlannedTotals;

export type DailyTargets = PlannedTotals;

/** How daily macros are split across the four canonical meals. */
const DEFAULT_DISTRIBUTION: Record<number, number> = {
  1: 0.25, // Breakfast
  2: 0.35, // Lunch
  3: 0.3, // Dinner
  4: 0.1, // Snacks
};

/** Map UI meal names to the `mealTypes` tags in the food database. */
function mealTypeKey(mealName: string): string {
  const n = mealName.toLowerCase();
  if (n === "snacks") return "snack";
  return n;
}

type DominantMacro = "protein" | "carbs" | "fat";

/** Minimum calorie share a macro must own for the food to be classified
 * as "X-dominant". Below this, the food's macro vector is too mixed for
 * the linear solver to use it as a basis vector. */
const DOMINANCE_THRESHOLD = 0.3;

/** Whichever macro contributes the most calories (no threshold). */
function dominantMacro(food: Food): DominantMacro {
  const p = food.protein * 4;
  const c = food.carbs * 4;
  const f = food.fat * 9;
  if (p >= c && p >= f) return "protein";
  if (c >= f) return "carbs";
  return "fat";
}

/** True if the food is dominantly `which` AND that macro owns at least
 * DOMINANCE_THRESHOLD of its calories. Used to build clean basis vectors
 * for the 3×3 solve. */
function isDominantlyEnough(food: Food, which: DominantMacro): boolean {
  if (dominantMacro(food) !== which) return false;
  const totalKcal = food.protein * 4 + food.carbs * 4 + food.fat * 9;
  if (totalKcal <= 0) return false;
  const share =
    which === "protein"
      ? (food.protein * 4) / totalKcal
      : which === "carbs"
        ? (food.carbs * 4) / totalKcal
        : (food.fat * 9) / totalKcal;
  return share >= DOMINANCE_THRESHOLD;
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function snap(grams: number): number {
  return Math.round(grams / PORTION_SNAP_GRAMS) * PORTION_SNAP_GRAMS;
}

/** 3×3 determinant. Exported for tests. */
export function det3(M: number[][]): number {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

/** Solve A·x = b via Cramer's rule. Returns null if singular or near-
 * singular (det small relative to the matrix's Frobenius-ish scale —
 * a cheap proxy for the condition number). Exported for tests. */
export function solve3x3(
  A: number[][],
  b: number[],
): [number, number, number] | null {
  const d = det3(A);
  // Scale-aware conditioning check. For a well-conditioned 3×3 the
  // determinant scales as (row norm)³; if it's tiny relative to the
  // matrix scale the rows are near-parallel and portion sizes will be
  // wildly sensitive to small target changes.
  let frob2 = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) frob2 += A[i][j] * A[i][j];
  if (Math.abs(d) < Math.max(1e-6, frob2 * 0.05)) return null;
  const x0 = det3([
    [b[0], A[0][1], A[0][2]],
    [b[1], A[1][1], A[1][2]],
    [b[2], A[2][1], A[2][2]],
  ]);
  const x1 = det3([
    [A[0][0], b[0], A[0][2]],
    [A[1][0], b[1], A[1][2]],
    [A[2][0], b[2], A[2][2]],
  ]);
  const x2 = det3([
    [A[0][0], A[0][1], b[0]],
    [A[1][0], A[1][1], b[1]],
    [A[2][0], A[2][1], b[2]],
  ]);
  return [x0 / d, x1 / d, x2 / d];
}

function buildFoodItem(food: Food, grams: number, id: number): FoodItem {
  const ratio = grams / 100;
  return {
    id,
    name: food.name,
    protein: Number.parseFloat((food.protein * ratio).toFixed(1)),
    carbs: Number.parseFloat((food.carbs * ratio).toFixed(1)),
    fat: Number.parseFloat((food.fat * ratio).toFixed(1)),
    calories: Math.round(food.calories * ratio),
    portionSize: grams,
    originalValues: {
      proteinPer100g: food.protein,
      carbsPer100g: food.carbs,
      fatPer100g: food.fat,
      caloriesPer100g: food.calories,
    },
  };
}

function totalsOf(foods: FoodItem[]): PlannedTotals {
  return foods.reduce<PlannedTotals>(
    (acc, f) => ({
      protein: acc.protein + f.protein,
      carbs: acc.carbs + f.carbs,
      fat: acc.fat + f.fat,
      calories: acc.calories + f.calories,
    }),
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
}

/** Plan a single meal that hits (protein, carbs, fat) targets by choosing
 * three foods (protein-dominant, carb-dominant, fat-dominant) and solving
 * a 3×3 linear system for their portion sizes. Tries up to MAX_TRIPLET_TRIES
 * food triplets; returns the first whose solution lies inside the portion
 * bounds. Optionally appends a fixed vegetable serving for volume/fibre. */
export function planMeal(
  availableFoods: Food[],
  targets: MealTargets,
  startId: number,
  options: { withVegetable?: boolean; dietPreference?: DietPreference } = {},
): FoodItem[] {
  // Diet filter is the very first cut: an obviously-wrong food (chicken
  // in a vegan plan) should never even reach the triplet search.
  const eligible = options.dietPreference
    ? filterByDiet(availableFoods, options.dietPreference)
    : availableFoods;

  const proteinFoods = shuffled(
    eligible.filter((f) => isDominantlyEnough(f, "protein")),
  );
  const carbFoods = shuffled(
    eligible.filter((f) => isDominantlyEnough(f, "carbs")),
  );
  const fatFoods = shuffled(
    eligible.filter((f) => isDominantlyEnough(f, "fat")),
  );
  const vegetables = shuffled(
    eligible.filter((f) => f.category === "vegetable"),
  );

  // If a vegetable is included, subtract its contribution from the targets
  // before solving for the macro-dominant triplet.
  const veg =
    options.withVegetable && vegetables.length > 0 ? vegetables[0] : null;
  const vegRatio = VEGETABLE_GRAMS / 100;
  const adjustedTargets: MealTargets = veg
    ? {
        protein: targets.protein - veg.protein * vegRatio,
        carbs: targets.carbs - veg.carbs * vegRatio,
        fat: targets.fat - veg.fat * vegRatio,
        calories: targets.calories - veg.calories * vegRatio,
      }
    : targets;

  let tries = 0;
  let nextId = startId;
  for (const p of proteinFoods) {
    if (tries > MAX_TRIPLET_TRIES) break;
    for (const c of carbFoods) {
      if (tries > MAX_TRIPLET_TRIES) break;
      for (const f of fatFoods) {
        tries++;
        if (tries > MAX_TRIPLET_TRIES) break;
        const A = [
          [p.protein, c.protein, f.protein],
          [p.carbs, c.carbs, f.carbs],
          [p.fat, c.fat, f.fat],
        ];
        const b = [
          Math.max(0, adjustedTargets.protein),
          Math.max(0, adjustedTargets.carbs),
          Math.max(0, adjustedTargets.fat),
        ];
        const x = solve3x3(A, b);
        if (!x) continue;
        const grams = x.map((xi) => xi * 100);
        const mins = [p, c, f].map((food) =>
          dominantMacro(food) === "fat"
            ? PORTION_GRAMS_MIN_FAT
            : PORTION_GRAMS_MIN_SOLID,
        );
        if (
          grams.some((g, i) => g < mins[i] || g > PORTION_GRAMS_MAX) ||
          grams.some((g) => !Number.isFinite(g))
        ) {
          continue;
        }
        const snapped = grams.map(snap);
        const result: FoodItem[] = [
          buildFoodItem(p, snapped[0], nextId++),
          buildFoodItem(c, snapped[1], nextId++),
          buildFoodItem(f, snapped[2], nextId++),
        ];
        if (veg) result.push(buildFoodItem(veg, VEGETABLE_GRAMS, nextId++));
        return result;
      }
    }
  }

  // Fallback: scale a single most-calorie-dense food to hit calories.
  // Macros will be off but we'll at least put something on the plate.
  // Still filtered by diet — never serve chicken to a vegan even when
  // the triplet search fails.
  if (eligible.length === 0) return [];
  const best = [...eligible].sort(
    (a, b) => b.protein * 4 + b.fat * 9 - (a.protein * 4 + a.fat * 9),
  )[0];
  if (!best || !Number.isFinite(best.calories) || best.calories <= 0) {
    return [];
  }
  const grams = Math.min(
    PORTION_GRAMS_MAX,
    Math.max(
      PORTION_GRAMS_MIN_SOLID,
      snap((targets.calories / best.calories) * 100),
    ),
  );
  return [buildFoodItem(best, grams, nextId)];
}

/** Compute a percent-of-target summary across the whole day. */
export function summarisePlan(
  plannedMeals: Meal[],
  daily: DailyTargets,
): {
  totals: PlannedTotals;
  percent: { protein: number; carbs: number; fat: number; calories: number };
  withinTolerance: boolean;
} {
  const totals = plannedMeals.reduce<PlannedTotals>(
    (acc, m) => {
      const t = totalsOf(m.foods);
      return {
        protein: acc.protein + t.protein,
        carbs: acc.carbs + t.carbs,
        fat: acc.fat + t.fat,
        calories: acc.calories + t.calories,
      };
    },
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  const percent = {
    protein: pct(totals.protein, daily.protein),
    carbs: pct(totals.carbs, daily.carbs),
    fat: pct(totals.fat, daily.fat),
    calories: pct(totals.calories, daily.calories),
  };
  const within = (n: number) => n >= 85 && n <= 115;
  return {
    totals,
    percent,
    withinTolerance:
      within(percent.protein) && within(percent.carbs) && within(percent.fat),
  };
}

/** Build a full-day plan, one meal at a time. Custom foods (passed via
 * `customFoods`) are eligible for every meal since they have no mealTypes
 * tag — the user added them deliberately. */
export function planDay(
  meals: Meal[],
  foodDatabase: Food[],
  daily: DailyTargets,
  options: {
    customFoods?: Food[];
    distribution?: Record<number, number>;
    dietPreference?: DietPreference;
  } = {},
): Meal[] {
  const distribution = options.distribution ?? DEFAULT_DISTRIBUTION;
  const customFoods = options.customFoods ?? [];
  let nextId = Date.now();
  return meals.map((meal) => {
    const share = distribution[meal.id] ?? 0.25;
    const targets: MealTargets = {
      protein: daily.protein * share,
      carbs: daily.carbs * share,
      fat: daily.fat * share,
      calories: daily.calories * share,
    };
    const mealKey = mealTypeKey(meal.name);
    const available = [
      ...foodDatabase.filter((f) => f.mealTypes?.includes(mealKey)),
      ...customFoods,
    ];
    const foods = planMeal(available, targets, nextId, {
      withVegetable: meal.id === 2 || meal.id === 3,
      dietPreference: options.dietPreference,
    });
    nextId += foods.length;
    return { ...meal, foods };
  });
}
