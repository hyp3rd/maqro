import type { FoodItem, Meal, PersonalInfo } from "@/components/macro/types";
import {
  clearDemoSeededStores,
  isProfileMarkedAsDemo,
  type DailyLog,
  type WaterIntake,
  type WeightEntry,
} from "./db";
import { notifyProfileChanged } from "./profile-bus";
import { notifyDataChanged } from "./sync/data-bus";

/** Seed dataset for the "Try with sample data" funnel on the
 *  landing page. The numbers are realistic enough that a new
 *  visitor immediately sees what the product feels like with a
 *  week of history - filled meals, a weight trend that justifies
 *  the plateau detector, a streak count, real macros.
 *
 *  Profile: 32 yo, female, 68 kg, 168 cm, moderate activity,
 *  losing weight at 0.4 kg/week. Target ≈ 1740 kcal/day with
 *  ~130 g protein.
 *
 *  This module is pure - it produces typed objects that callers
 *  (currently [hooks/use-demo-seed.ts](../hooks/use-demo-seed.ts))
 *  feed into the IndexedDB write helpers. We deliberately don't
 *  touch the database here so it stays trivially testable. */

/** Anchored profile values for the sample dataset. */
export function getDemoProfile(): PersonalInfo {
  return {
    displayName: "Sample",
    gender: "female",
    age: 32,
    weight: 68,
    height: 168,
    activityLevel: "moderate",
    goal: "lose",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: ["mediterranean"],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0.4,
    manualTdee: null,
    macroSplit: null,
    units: "metric",
  };
}

/** Minimal per-100g shape we use to scale a food into a logged
 *  FoodItem at a chosen portion. Mirrors what `addFood` would
 *  store from the catalog at log time. */
type Per100 = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  category: string;
};

/** Curated mini-catalog. Numbers match
 *  [data/food-database.ts](../data/food-database.ts) - we don't
 *  import it directly to keep this module small (it's bundled
 *  client-side via the seed hook). */
const FOODS: Record<string, Per100> = {
  "Greek Yogurt": {
    protein: 10,
    carbs: 4,
    fat: 0.4,
    calories: 59,
    category: "dairy",
  },
  Oats: { protein: 13, carbs: 68, fat: 7, calories: 389, category: "grain" },
  Egg: {
    protein: 13,
    carbs: 1,
    fat: 11,
    calories: 155,
    category: "lean protein",
  },
  Banana: {
    protein: 1.1,
    carbs: 23,
    fat: 0.3,
    calories: 89,
    category: "fruit",
  },
  "Chicken Breast": {
    protein: 31,
    carbs: 0,
    fat: 3.6,
    calories: 165,
    category: "lean protein",
  },
  Salmon: {
    protein: 20,
    carbs: 0,
    fat: 13,
    calories: 208,
    category: "fatty protein",
  },
  "Brown Rice": {
    protein: 2.6,
    carbs: 23,
    fat: 0.9,
    calories: 111,
    category: "grain",
  },
  "Sweet Potato": {
    protein: 1.6,
    carbs: 20,
    fat: 0.1,
    calories: 86,
    category: "vegetable",
  },
  Broccoli: {
    protein: 2.8,
    carbs: 7,
    fat: 0.4,
    calories: 34,
    category: "vegetable",
  },
  Spinach: {
    protein: 2.9,
    carbs: 3.6,
    fat: 0.4,
    calories: 23,
    category: "vegetable",
  },
  Almonds: { protein: 21, carbs: 22, fat: 49, calories: 579, category: "nut" },
  Apple: { protein: 0.3, carbs: 14, fat: 0.2, calories: 52, category: "fruit" },
  "Olive Oil": {
    protein: 0,
    carbs: 0,
    fat: 100,
    calories: 884,
    category: "fat",
  },
  Quinoa: {
    protein: 4.4,
    carbs: 21,
    fat: 1.9,
    calories: 120,
    category: "grain",
  },
};

/** Scale a per-100g food into a FoodItem at the given portion.
 *  `id` and `selectedMealId` are managed by the calling code. */
function item(
  id: number,
  name: keyof typeof FOODS,
  portionSize: number,
  mealId: number,
): FoodItem {
  const per100 = FOODS[name];
  const ratio = portionSize / 100;
  return {
    id,
    name,
    portionSize,
    selectedMealId: mealId,
    category: per100.category,
    protein: round1(per100.protein * ratio),
    carbs: round1(per100.carbs * ratio),
    fat: round1(per100.fat * ratio),
    calories: Math.round(per100.calories * ratio),
    originalValues: {
      proteinPer100g: per100.protein,
      carbsPer100g: per100.carbs,
      fatPer100g: per100.fat,
      caloriesPer100g: per100.calories,
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Day templates - each one is a realistic ~1700 kcal day with
 *  ~130 g protein. We rotate through 4 of these across the
 *  7-day window so the demo data isn't identical day-to-day. */
type DayTemplate = (baseId: number) => Meal[];

const DAY_TEMPLATES: DayTemplate[] = [
  // Day A - yogurt breakfast, chicken lunch, salmon dinner.
  (i) => [
    {
      id: 1,
      name: "Breakfast",
      foods: [
        item(i + 1, "Greek Yogurt", 200, 1),
        item(i + 2, "Oats", 40, 1),
        item(i + 3, "Banana", 100, 1),
      ],
    },
    {
      id: 2,
      name: "Lunch",
      foods: [
        item(i + 4, "Chicken Breast", 150, 2),
        item(i + 5, "Brown Rice", 150, 2),
        item(i + 6, "Broccoli", 120, 2),
      ],
    },
    {
      id: 3,
      name: "Dinner",
      foods: [
        item(i + 7, "Salmon", 120, 3),
        item(i + 8, "Sweet Potato", 200, 3),
        item(i + 9, "Spinach", 80, 3),
      ],
    },
    {
      id: 4,
      name: "Snacks",
      foods: [item(i + 10, "Almonds", 25, 4), item(i + 11, "Apple", 150, 4)],
    },
  ],
  // Day B - eggs breakfast, salmon lunch, chicken dinner.
  (i) => [
    {
      id: 1,
      name: "Breakfast",
      foods: [
        item(i + 1, "Egg", 100, 1),
        item(i + 2, "Oats", 50, 1),
        item(i + 3, "Banana", 80, 1),
      ],
    },
    {
      id: 2,
      name: "Lunch",
      foods: [
        item(i + 4, "Salmon", 130, 2),
        item(i + 5, "Quinoa", 120, 2),
        item(i + 6, "Spinach", 100, 2),
      ],
    },
    {
      id: 3,
      name: "Dinner",
      foods: [
        item(i + 7, "Chicken Breast", 160, 3),
        item(i + 8, "Sweet Potato", 180, 3),
        item(i + 9, "Broccoli", 100, 3),
        item(i + 10, "Olive Oil", 5, 3),
      ],
    },
    { id: 4, name: "Snacks", foods: [item(i + 11, "Greek Yogurt", 150, 4)] },
  ],
  // Day C - lighter day, slightly under target (real users have
  // these too).
  (i) => [
    {
      id: 1,
      name: "Breakfast",
      foods: [
        item(i + 1, "Greek Yogurt", 180, 1),
        item(i + 2, "Banana", 120, 1),
      ],
    },
    {
      id: 2,
      name: "Lunch",
      foods: [
        item(i + 3, "Chicken Breast", 140, 2),
        item(i + 4, "Brown Rice", 130, 2),
        item(i + 5, "Broccoli", 150, 2),
      ],
    },
    {
      id: 3,
      name: "Dinner",
      foods: [
        item(i + 6, "Salmon", 110, 3),
        item(i + 7, "Quinoa", 100, 3),
        item(i + 8, "Spinach", 120, 3),
      ],
    },
    {
      id: 4,
      name: "Snacks",
      foods: [item(i + 9, "Apple", 180, 4), item(i + 10, "Almonds", 20, 4)],
    },
  ],
  // Day D - a slightly-over day with the snack monster fully
  // expressed.
  (i) => [
    {
      id: 1,
      name: "Breakfast",
      foods: [item(i + 1, "Egg", 150, 1), item(i + 2, "Oats", 60, 1)],
    },
    {
      id: 2,
      name: "Lunch",
      foods: [
        item(i + 3, "Chicken Breast", 180, 2),
        item(i + 4, "Sweet Potato", 220, 2),
        item(i + 5, "Broccoli", 100, 2),
      ],
    },
    {
      id: 3,
      name: "Dinner",
      foods: [
        item(i + 6, "Salmon", 140, 3),
        item(i + 7, "Brown Rice", 160, 3),
        item(i + 8, "Spinach", 90, 3),
      ],
    },
    {
      id: 4,
      name: "Snacks",
      foods: [
        item(i + 9, "Greek Yogurt", 200, 4),
        item(i + 10, "Almonds", 30, 4),
        item(i + 11, "Apple", 150, 4),
      ],
    },
  ],
];

/** Subtract `n` days from a `YYYY-MM-DD` date string. */
function subtractDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - n);
  const yy = dt.getFullYear();
  const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Produce 7 days of meal logs ending on `today`. The current day
 *  is included so the user lands on the planner with today already
 *  populated - feels live, not historical-only. */
export function getDemoMealLogs(
  today: string,
  now: number = Date.now(),
): DailyLog[] {
  const logs: DailyLog[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = subtractDays(today, offset);
    const template = DAY_TEMPLATES[offset % DAY_TEMPLATES.length];
    const meals = template(offset * 100);
    // updatedAt fans out across the week so the sync engine has
    // believable per-day timestamps instead of all-the-same-ms.
    const updatedAt = now - offset * 24 * 3600_000;
    const iso = new Date(updatedAt).toISOString();
    logs.push({
      date,
      meals,
      updatedAt,
      localUpdatedAt: iso,
      serverUpdatedAt: iso,
    });
  }
  return logs;
}

/** Produce 14 daily weight entries with a gentle downward trend
 *  (~0.4 kg/week loss) and realistic day-to-day noise. Starts at
 *  ~68.8 kg and ends at ~68.0 kg matching `getDemoProfile().weight`. */
export function getDemoWeightHistory(
  today: string,
  now: number = Date.now(),
): WeightEntry[] {
  const entries: WeightEntry[] = [];
  const days = 14;
  // Deterministic pseudo-random noise so the same seed produces
  // the same trend (useful for tests). Range ±0.3 kg.
  const noise = (i: number): number =>
    (Math.sin(i * 12.9898) * 43758.5453) % 1 || 0;

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = subtractDays(today, offset);
    // Linear trend from 68.8 → 68.0 across 14 days = -0.057 kg/day
    const trend = 68.0 + offset * 0.057;
    const kg = round1(trend + noise(offset) * 0.3);
    const recordedAt = now - offset * 24 * 3600_000;
    const iso = new Date(recordedAt).toISOString();
    entries.push({
      date,
      kg,
      recordedAt,
      localUpdatedAt: iso,
      serverUpdatedAt: iso,
    });
  }
  return entries;
}

/** Produce 14 days of daily water totals trending around the demo
 *  profile's goal (68 kg → ~2.4 L), so the Hydration card lands
 *  populated. Deterministic noise (a different seed than the weight
 *  series) keeps the totals believable, ~1.8–2.4 L/day. */
export function getDemoWaterLogs(
  today: string,
  now: number = Date.now(),
): WaterIntake[] {
  const entries: WaterIntake[] = [];
  const days = 14;
  const noise = (i: number): number =>
    (Math.sin(i * 78.233) * 43758.5453) % 1 || 0;

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = subtractDays(today, offset);
    // Centre ~2.1 L with ±0.3 L noise, rounded to a tidy 10 ml.
    const ml = Math.round((2100 + noise(offset) * 300) / 10) * 10;
    const recordedAt = now - offset * 24 * 3600_000;
    const iso = new Date(recordedAt).toISOString();
    entries.push({
      date,
      ml,
      recordedAt,
      localUpdatedAt: iso,
      serverUpdatedAt: iso,
    });
  }
  return entries;
}

/** localStorage flag set by the seed routine. Kept alongside the
 *  durable IDB marker on the profile row so synchronous callers (the
 *  Settings page, a "this is sample data" banner) can check demo mode
 *  without an async IDB read. `clearDemoModeData` consults both
 *  signals — the IDB marker is the load-bearing one. */
export const DEMO_FLAG_KEY = "maqro:demo-loaded";

/** True when this device's IDB currently holds demo data. */
export function isDemoModeActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Wipe the demo dataset (only the stores the seed actually populated:
 *  profile, dailyLogs, weightHistory) and clear the flag. Called on
 *  sign-in BEFORE the initial sync so demo rows don't get pushed up
 *  into the user's real Supabase account — the bug that motivated this
 *  helper was: visit landing → "Try with sample data" → sign in → sync
 *  pushes demo data over the user's actual logs.
 *
 *  Detects demo state from **either** the localStorage flag or an IDB
 *  marker (`profile._demoSeeded`) — the IDB signal exists so a private
 *  window / quota-exceeded localStorage write doesn't drop the marker
 *  and let demo data leak.
 *
 *  Only the demo-seeded stores are cleared. Pantry items, recipes,
 *  custom foods, templates, favourites etc. the user added while
 *  exploring stay — they aren't demo data and the user expects them to
 *  carry over into their signed-in account on the upcoming sync. */
export async function clearDemoModeData(): Promise<void> {
  let active = isDemoModeActive();
  if (!active) {
    try {
      active = await isProfileMarkedAsDemo();
    } catch {
      // IDB unreachable — leave `active` false; nothing to clear.
    }
  }
  if (!active) return;
  try {
    await clearDemoSeededStores();
  } finally {
    try {
      window.localStorage.removeItem(DEMO_FLAG_KEY);
    } catch {
      // ignore — IDB marker has been cleared with the profile row, so
      // re-running this is idempotent.
    }
  }
  // Bump the data-bus versions for the stores we actually touched so
  // any mounted view re-reads from the now-empty IDB and shows a brief
  // loading state until the upcoming sync pull lands the real rows.
  notifyProfileChanged();
  notifyDataChanged("dailyLogs");
  notifyDataChanged("weightHistory");
  notifyDataChanged("waterIntake");
  notifyDataChanged("shoppingListMeta");
}
