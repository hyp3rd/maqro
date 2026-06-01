import type { FoodItem, Meal } from "@/components/macro/types";

/** A machine-checked complaint about an AI-submitted meal plan. The route
 *  feeds the `message`s back to the model as a tool_result is_error so it
 *  can correct the plan within the iteration budget. `code` is a stable
 *  identifier for telemetry / client-side grouping; `message` is the
 *  user-facing (and AI-facing) sentence. */
export type CoherenceIssue = {
  code:
    | "standalone-fat"
    | "multi-fish"
    | "multi-meat"
    | "fish-and-meat"
    | "naked-carb"
    | "snack-monster"
    | "low-day-protein";
  message: string;
  /** Name of the meal slot the issue applies to (matches `Meal.name`).
   *  Absent for day-level checks like `low-day-protein` which apply
   *  to the whole plan rather than a single meal. The client uses
   *  this to anchor a warning badge on the offending meal card; when
   *  absent it renders the issue as a global banner instead. */
  mealName?: string;
};

/** Foods whose macros are overwhelmingly fat AND that aren't recognizable
 *  meals on their own. "Standalone-fat" is keyed off of macro composition
 *  (fat fraction of kcal) rather than this list - this is just used as a
 *  sanity check for natural-language messages. */
const FATS = [
  "olive oil",
  "vegetable oil",
  "sunflower oil",
  "coconut oil",
  "sesame oil",
  "avocado oil",
  "butter",
  "ghee",
  "lard",
  "tallow",
  "mayonnaise",
] as const;

/** Common fish names the AI repeatedly picks. Substring matches against
 *  the food's display name (case-insensitive). Keep concise; better to
 *  miss a niche fish than to false-positive (which would block the AI
 *  from a valid plan). */
const FISH = [
  "salmon",
  "tuna",
  "trout",
  "cod",
  "halibut",
  "sea bass",
  "pangasius",
  "tilapia",
  "mackerel",
  "sardine",
  "anchovy",
  "herring",
  "swordfish",
  "snapper",
  "haddock",
  "shrimp",
  "prawn",
  "lobster",
  "crab",
  "octopus",
  "squid",
  "calamari",
  "mussel",
  "scallop",
  "oyster",
  "clam",
] as const;

/** Common land-meat names. Same matching rules as FISH. */
const MEAT = [
  "chicken",
  "turkey",
  "duck",
  "beef",
  "steak",
  "veal",
  "pork",
  "bacon",
  "ham",
  "sausage",
  "lamb",
  "mutton",
  "rabbit",
  "venison",
  "prosciutto",
  "salami",
  "pepperoni",
  "chorizo",
] as const;

/** Words that mark a food as a protein source for the naked-carb check.
 *  Combined fish + meat + plant proteins + eggs + dairy + legumes. We're
 *  permissive here on purpose - false positives on "this isn't a protein
 *  source" complaints would be more disruptive than false negatives. */
const PROTEIN_SOURCES = [
  ...FISH,
  ...MEAT,
  "egg",
  "tofu",
  "tempeh",
  "seitan",
  "yogurt",
  "yoghurt",
  "cheese",
  "cottage",
  "ricotta",
  "milk",
  "whey",
  "protein powder",
  "lentil",
  "chickpea",
  "bean",
  "edamame",
  "quinoa",
  "hummus",
] as const;

/** Foods we'd characterize as a "snack" in the snack-monster check. These
 *  are the things people eat between meals, standing up. A snack with
 *  multiple categories from this list reads as a snack; the violation
 *  comes from mixing 3+ when the goal was a snack. */
const SNACK_CATEGORIES: ReadonlyArray<{
  name: string;
  matchers: ReadonlyArray<string>;
}> = [
  {
    name: "fruit",
    matchers: [
      "apple",
      "banana",
      "berry",
      "berries",
      "raspberr",
      "blueberr",
      "strawberr",
      "blackberr",
      "grape",
      "pear",
      "peach",
      "plum",
      "orange",
      "mandarin",
      "pineapple",
      "mango",
      "kiwi",
      "melon",
      "watermelon",
      "cherry",
      "fig",
      "date",
    ],
  },
  {
    name: "nuts",
    matchers: [
      "almond",
      "walnut",
      "cashew",
      "pistachio",
      "pecan",
      "hazelnut",
      "peanut",
      "macadamia",
      "nut butter",
      "seed",
    ],
  },
  {
    name: "dairy",
    matchers: ["yogurt", "yoghurt", "cheese", "cottage", "ricotta", "kefir"],
  },
  { name: "fish", matchers: [...FISH] },
  { name: "meat", matchers: [...MEAT] },
  {
    name: "crackers/grain",
    matchers: ["cracker", "rice cake", "bread", "toast", "pretzel"],
  },
  { name: "chocolate/sweet", matchers: ["chocolate", "cocoa"] },
];

/** Fraction-of-kcal at which a meal is considered "all fat" for the
 *  standalone-fat check. 0.80 was picked so a salad-with-olive-oil
 *  (mixed-macro) passes while a 65g-of-olive-oil "lunch" fails. */
const STANDALONE_FAT_FRACTION = 0.8;
/** Below this kcal a main meal is considered "tiny" and the
 *  naked-carb rule skips it - the meal has bigger problems than its
 *  protein composition. */
const NAKED_CARB_MIN_KCAL = 200;
/** Floor on day's total protein as a fraction of the protein target.
 *  Below this and the validator complains because the model has clearly
 *  optimized for kcal without checking protein. 0.6 leaves slack for
 *  cuisines/diets where protein is genuinely harder to hit (e.g. vegan
 *  on a very high target). */
const LOW_DAY_PROTEIN_FRACTION = 0.6;
/** The day-level protein rule only fires when the plan looks like a
 *  full day - fewer slots than this and the target doesn't sensibly
 *  apply to what's been planned (single-meal regen, test fixtures with
 *  one Breakfast slot, etc.). */
const FULL_DAY_MIN_MEALS = 3;

function lowerName(f: FoodItem): string {
  return f.name.toLowerCase();
}

function mealContainsAny(meal: Meal, needles: ReadonlyArray<string>): string[] {
  const hits = new Set<string>();
  for (const f of meal.foods) {
    const name = lowerName(f);
    for (const n of needles) {
      if (name.includes(n)) hits.add(n);
    }
  }
  return [...hits];
}

/** Map a hit substring back to the most-recognizable food in the meal
 *  whose name contained it. Used to produce a user-readable message like
 *  "has both Salmon and Pangasius" rather than echoing the lowercase
 *  substring. */
function foodNameContaining(meal: Meal, needle: string): string {
  const f = meal.foods.find((f) => lowerName(f).includes(needle));
  return f?.name ?? needle;
}

function fatKcal(f: FoodItem): number {
  return f.fat * 9;
}

function totalKcal(meal: Meal): number {
  return meal.foods.reduce((acc, f) => acc + f.calories, 0);
}

function totalFatKcal(meal: Meal): number {
  return meal.foods.reduce((acc, f) => acc + fatKcal(f), 0);
}

function isSnackSlot(meal: Meal): boolean {
  return /snack/i.test(meal.name);
}

function checkStandaloneFat(meal: Meal): CoherenceIssue | null {
  if (meal.foods.length !== 1) return null;
  const kcal = totalKcal(meal);
  if (kcal < 50) return null; // empty / negligible meal - different problem
  const fatFrac = totalFatKcal(meal) / kcal;
  if (fatFrac <= STANDALONE_FAT_FRACTION) return null;
  const only = meal.foods[0];
  return {
    code: "standalone-fat",
    message: `${meal.name} is only ${only.name} - that's ${Math.round(kcal)} kcal of pure fat, not a meal. Replace with at least one protein source and a carb or vegetable.`,
    mealName: meal.name,
  };
}

function checkMultiFish(meal: Meal): CoherenceIssue | null {
  const hits = mealContainsAny(meal, FISH);
  if (hits.length < 2) return null;
  const a = foodNameContaining(meal, hits[0]);
  const b = foodNameContaining(meal, hits[1]);
  return {
    code: "multi-fish",
    message: `${meal.name} has both ${a} and ${b}. Pick one fish per meal.`,
    mealName: meal.name,
  };
}

function checkMultiMeat(meal: Meal): CoherenceIssue | null {
  const hits = mealContainsAny(meal, MEAT);
  if (hits.length < 2) return null;
  const a = foodNameContaining(meal, hits[0]);
  const b = foodNameContaining(meal, hits[1]);
  return {
    code: "multi-meat",
    message: `${meal.name} has both ${a} and ${b}. Pick one meat per meal.`,
    mealName: meal.name,
  };
}

function checkFishAndMeat(meal: Meal): CoherenceIssue | null {
  const fish = mealContainsAny(meal, FISH);
  const meat = mealContainsAny(meal, MEAT);
  if (fish.length === 0 || meat.length === 0) return null;
  const a = foodNameContaining(meal, fish[0]);
  const b = foodNameContaining(meal, meat[0]);
  return {
    code: "fish-and-meat",
    message: `${meal.name} mixes ${a} (fish) and ${b} (meat). Pick one protein per meal.`,
    mealName: meal.name,
  };
}

function checkNakedCarb(meal: Meal): CoherenceIssue | null {
  if (isSnackSlot(meal)) return null;
  if (meal.foods.length === 0) return null;
  const kcal = totalKcal(meal);
  if (kcal < NAKED_CARB_MIN_KCAL) return null;
  // The rule is "no recognized protein source in the meal" - pure
  // substring detection across a permissive list. Macro fractions
  // alone are unreliable because rice + broccoli can hit 10% protein
  // and still feel like a naked-carb plate to a human.
  const hasProtein = mealContainsAny(meal, PROTEIN_SOURCES).length > 0;
  if (hasProtein) return null;
  return {
    code: "naked-carb",
    message: `${meal.name} has no protein source - only carbs and fat. Add chicken, fish, eggs, tofu, beans, or dairy.`,
    mealName: meal.name,
  };
}

function checkSnackMonster(meal: Meal): CoherenceIssue | null {
  if (!isSnackSlot(meal)) return null;
  if (meal.foods.length < 3) return null;
  const categoriesHit = new Set<string>();
  for (const f of meal.foods) {
    const name = lowerName(f);
    for (const cat of SNACK_CATEGORIES) {
      if (cat.matchers.some((m) => name.includes(m))) {
        categoriesHit.add(cat.name);
      }
    }
  }
  if (categoriesHit.size < 3) return null;
  return {
    code: "snack-monster",
    message: `${meal.name} mixes too many things for a snack (${[...categoriesHit].join(" + ")}). Pick one: a piece of fruit, nuts, yogurt, or cheese with crackers.`,
    mealName: meal.name,
  };
}

function checkLowDayProtein(
  meals: Meal[],
  targets: { protein: number },
): CoherenceIssue | null {
  if (targets.protein <= 0) return null;
  if (meals.length < FULL_DAY_MIN_MEALS) return null;
  const actual = meals.reduce(
    (acc, m) => acc + m.foods.reduce((mAcc, f) => mAcc + f.protein, 0),
    0,
  );
  const fraction = actual / targets.protein;
  if (fraction >= LOW_DAY_PROTEIN_FRACTION) return null;
  const pct = Math.round(fraction * 100);
  return {
    code: "low-day-protein",
    message: `Day's total protein is ${Math.round(actual)} g (target ${targets.protein} g - only ${pct}%). Most meals need a protein source - add chicken, fish, eggs, tofu, or dairy.`,
  };
}

/** Validate a resolved meal plan against the deterministic coherence
 *  rules. Returns one issue per affected meal/rule combination - empty
 *  array means the plan passed every check. The route feeds the
 *  `message`s back to the AI on a retry; the client surfaces them to
 *  the user when the loop exhausts iterations without producing a
 *  clean plan. */
export function validatePlanCoherence(
  meals: Meal[],
  targets: { protein: number; calories: number },
): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  for (const meal of meals) {
    // Skip empty meals - they're a different kind of problem (handled
    // by the route's "every meal empty" 502 path).
    if (meal.foods.length === 0) continue;
    const perMeal = [
      checkStandaloneFat(meal),
      checkMultiFish(meal),
      checkMultiMeat(meal),
      checkFishAndMeat(meal),
      checkNakedCarb(meal),
      checkSnackMonster(meal),
    ].filter((x): x is CoherenceIssue => x !== null);
    issues.push(...perMeal);
  }
  const dayProtein = checkLowDayProtein(meals, targets);
  if (dayProtein) issues.push(dayProtein);
  return issues;
}

/** Exposed for tests. The route depends on the substring rather than
 *  the exported list directly - keeping these private would force tests
 *  to duplicate strings the validator already knows about. */
export const __TEST_ONLY__ = { FATS, FISH, MEAT, PROTEIN_SOURCES };
