import type { Food, FoodItem, Meal } from "@/components/macro/types";

/** The AI returns a list of meal slots with food picks identified by name +
 * portion in grams. Macros are computed server-side from the catalog so the
 * AI can't hallucinate nutrient values — it only picks foods and sizes. */
export type AiMealPick = { name: string; portionGrams: number };
export type AiMealSlot = { name: string; foods: AiMealPick[] };
export type AiPlanShape = { meals: AiMealSlot[] };

const PORTION_MIN = 5;
const PORTION_MAX = 500;
const PORTION_SNAP = 5;
/** Substring fallback only kicks in when the shorter normalized name is at
 * least this many characters. 4 catches single-token seeds like "Oats" and
 * "Tofu" against verbose paraphrases ("rolled oats", "firm tofu") while
 * keeping 3-char seeds like "Egg" exact-match only. */
const SUBSTRING_MIN_LEN = 4;

function clampPortion(grams: number): number {
  if (!Number.isFinite(grams)) return PORTION_MIN;
  const snapped = Math.round(grams / PORTION_SNAP) * PORTION_SNAP;
  return Math.max(PORTION_MIN, Math.min(PORTION_MAX, snapped));
}

/** Aggressively normalize a food name so the AI's submitted picks resolve
 * against the catalog even when it paraphrases. Drops parentheticals
 * (`"Yogurt (Fage)"` → `"yogurt"`), brand/qualifier suffixes after a comma
 * or dash (`"Yogurt, Plain — Fage Total"` → `"yogurt plain"` … actually
 * `"yogurt"` since we strip after the first comma/dash), strips accents and
 * punctuation, and collapses whitespace. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[,—–-].*$/u, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a single pick name against the catalog. Exact normalized match
 * first, then substring containment with `SUBSTRING_MIN_LEN` guard. Returns
 * `undefined` if nothing reasonable matches. */
/** Resolve a pick name to a catalog food via aggressive normalization with
 *  a word-boundary substring fallback. Exported so the recipe converter
 *  shares the exact same matching semantics — same edge cases, same tests. */
export function matchPick(
  pickName: string,
  catalog: Food[],
  byNorm: Map<string, Food>,
): Food | undefined {
  const norm = normalizeName(pickName);
  if (!norm) return undefined;
  const exact = byNorm.get(norm);
  if (exact) return exact;
  // Word-boundary substring fallback: the shorter normalized name must
  // appear as a whole word in the longer, not buried in another token
  // (otherwise "egg" would match "eggplant"). Padding both sides with
  // spaces and searching for ` needle ` is the simplest way to enforce
  // that on already-normalized, single-space-separated strings.
  const paddedNorm = ` ${norm} `;
  for (const f of catalog) {
    const cNorm = normalizeName(f.name);
    if (!cNorm) continue;
    const minLen = Math.min(norm.length, cNorm.length);
    if (minLen < SUBSTRING_MIN_LEN) continue;
    const paddedC = ` ${cNorm} `;
    if (paddedC.includes(paddedNorm) || paddedNorm.includes(paddedC)) return f;
  }
  return undefined;
}

/** Build the normalized-name → Food index used by `matchPick`. Exported
 *  alongside `matchPick` so callers can amortize the index build across
 *  many lookups. */
export function buildNormIndex(catalog: Food[]): Map<string, Food> {
  const m = new Map<string, Food>();
  for (const f of catalog) {
    const n = normalizeName(f.name);
    if (n && !m.has(n)) m.set(n, f);
  }
  return m;
}

/** Return every pick name in the AI plan that won't resolve to a catalog
 * entry. Used by the route to feed a validation error back to the model so
 * it can correct its names within the iteration budget rather than failing
 * the whole plan with an empty-meals 502. */
export function unmatchedPickNames(
  aiPlan: AiPlanShape,
  catalog: Food[],
): string[] {
  const byNorm = buildNormIndex(catalog);
  const out: string[] = [];
  const aiMeals = Array.isArray(aiPlan?.meals) ? aiPlan.meals : [];
  for (const meal of aiMeals) {
    if (!meal || !Array.isArray(meal.foods)) continue;
    for (const pick of meal.foods) {
      if (!pick || typeof pick.name !== "string") continue;
      if (!matchPick(pick.name, catalog, byNorm)) out.push(pick.name);
    }
  }
  return out;
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

/** Convert an AI plan into the local `Meal[]` shape used by the meal-plan
 * view. Picks are resolved against the catalog by normalized name (exact)
 * with a substring fallback for paraphrased OFF names — see `matchPick`.
 * Picks that still don't resolve are silently dropped: we never invent
 * macros for foods we don't know. Portions are clamped + snapped to the
 * same grid the deterministic planner uses. */
export function aiPlanToMeals(
  aiPlan: AiPlanShape,
  mealNames: string[],
  catalog: Food[],
  startId: number = Date.now(),
): Meal[] {
  const byNorm = buildNormIndex(catalog);

  // Defensive: the AI is *forced* into submit_meal_plan via tool_choice on
  // the last iteration, but it can still hand us a partial / malformed
  // input (missing `meals`, missing `foods`, non-array values). Treat any
  // shape oddity as "no picks" rather than crashing — empty meal slots
  // are far less alarming than a 500 from the route.
  const aiMeals = Array.isArray(aiPlan?.meals) ? aiPlan.meals : [];

  let nextId = startId;
  return mealNames.map((slotName, idx) => {
    const aiMeal =
      aiMeals.find(
        (m) =>
          typeof m?.name === "string" &&
          m.name.toLowerCase().trim() === slotName.toLowerCase().trim(),
      ) ?? aiMeals[idx];

    const foods: FoodItem[] = [];
    if (aiMeal && Array.isArray(aiMeal.foods)) {
      for (const pick of aiMeal.foods) {
        if (!pick || typeof pick.name !== "string") continue;
        const food = matchPick(pick.name, catalog, byNorm);
        if (!food) continue;
        const grams =
          typeof pick.portionGrams === "number" ? pick.portionGrams : 100;
        foods.push(buildFoodItem(food, clampPortion(grams), nextId++));
      }
    }
    return { id: idx + 1, name: slotName, foods };
  });
}
