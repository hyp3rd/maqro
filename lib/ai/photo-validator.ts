/** Machine-checked plausibility complaints against AI-estimated food
 *  macros from the meal-photo identification route. Items that match
 *  the catalog use catalog macros (truth) — the validator only runs on
 *  items whose macros the model invented. Each issue is phrased as a
 *  concrete instruction so the route can feed it back to the model as
 *  an `is_error` tool_result and the model can correct on retry.
 *
 *  All rules are deterministic and run on per-100g macros (the unit the
 *  route operates in). The `index` lets the route map an issue back to
 *  the food the model named so the message can stay specific. */
export type PhotoIssue = {
  code:
    | "macro-sum-too-high"
    | "kcal-macro-mismatch"
    | "oil-portion-too-large"
    | "fat-claimed-as-protein"
    | "category-impossible";
  /** Position in the AI-submitted `foods` array. */
  index: number;
  message: string;
};

export type EstimatedItem = {
  name: string;
  portionGrams: number;
  macros: { protein: number; carbs: number; fat: number; calories: number };
};

/** A macro stays "plausible" while it sits inside these per-100g caps
 *  for its category. The model can break the limit (rules below catch
 *  it); these are just the upper bounds we consider sane.
 *
 *  Numbers are rounded from USDA / common nutrition references. Pure
 *  oils are the most rigid (must be ~100% fat); other categories have
 *  more variance. */
const PURE_FAT_KEYWORDS = [
  "olive oil",
  "vegetable oil",
  "sunflower oil",
  "coconut oil",
  "avocado oil",
  "sesame oil",
  "butter",
  "ghee",
  "lard",
  "tallow",
  "mayonnaise",
  "mayo",
] as const;

const SAUCE_DRESSING_KEYWORDS = [
  "sauce",
  "dressing",
  "syrup",
  "ketchup",
  "mustard",
  "vinaigrette",
  "salsa",
] as const;

/** When the AI claims macros sum above this many g per 100 g, the
 *  estimate is physically impossible — 100 g of food can't contain >
 *  100 g of macronutrient. 105 leaves a small slack for label-rounding
 *  edge cases (some packaged foods do report sums slightly over 100
 *  due to fiber-counted-twice quirks). */
const MAX_MACRO_SUM_G = 105;

/** Tolerance band on `4P + 4C + 9F ≈ calories`. ±30% covers
 *  legitimate variance from fiber, polyols, and alcohol (which adds 7
 *  kcal/g and isn't accounted for) without letting the model dump 500
 *  kcal of "rice" on a low-macro estimate. */
const KCAL_TOLERANCE = 0.3;

/** Oil/dressing portions above this gram count are almost certainly a
 *  visual misread — a sheen of oil on roast vegetables is 5–15 g, not
 *  100 g. Bigger than this needs a re-check. */
const MAX_PLAUSIBLE_OIL_GRAMS = 50;

function nameMatchesAny(name: string, needles: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Validate AI-estimated per-100g macros + portions for the foods the
 *  meal-photo route is about to ship to the client. Returns one issue
 *  per affected food (caps at one per rule per item so the error
 *  message stays focused). Empty array → plausible. */
export function validatePhotoMacros(items: EstimatedItem[]): PhotoIssue[] {
  const issues: PhotoIssue[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { protein, carbs, fat, calories } = item.macros;

    // Rule 1: macros sum > 105 g / 100 g is physically impossible.
    const macroSum = protein + carbs + fat;
    if (macroSum > MAX_MACRO_SUM_G) {
      issues.push({
        code: "macro-sum-too-high",
        index: i,
        message: `${item.name}: claimed macros sum to ${macroSum.toFixed(1)} g per 100 g (P${protein} C${carbs} F${fat}) — impossible. The per-100 g macros must sum to ≤ 100 g. Re-estimate.`,
      });
      continue;
    }

    // Rule 2: kcal must roughly match 4P + 4C + 9F. Skip when calories
    // is 0 (e.g. plain water/tea) so we don't flag legitimate zeros.
    const expectedKcal = protein * 4 + carbs * 4 + fat * 9;
    if (calories > 0 && expectedKcal > 0) {
      const ratio = calories / expectedKcal;
      if (ratio < 1 - KCAL_TOLERANCE || ratio > 1 + KCAL_TOLERANCE) {
        issues.push({
          code: "kcal-macro-mismatch",
          index: i,
          message: `${item.name}: claimed ${calories} kcal/100 g but macros (P${protein} C${carbs} F${fat}) imply ${Math.round(expectedKcal)} kcal. They should match within ±30%. Recheck the macros or the kcal.`,
        });
      }
    }

    // Rule 3: pure fats (oils, butter, ghee, mayo) must be ~all fat.
    // Anything else is wrong — the most common failure is calling a
    // condiment a "protein source".
    if (nameMatchesAny(item.name, PURE_FAT_KEYWORDS)) {
      if (protein > 5 || carbs > 5 || fat < 70) {
        issues.push({
          code: "category-impossible",
          index: i,
          message: `${item.name} is a pure fat — should be ~90–100 g fat per 100 g with near-zero protein and carbs. You claimed P${protein} C${carbs} F${fat}. Recheck the macros.`,
        });
      }
    }

    // Rule 4: oils/sauces/dressings rarely exceed 50 g per portion in
    // a normal meal. If the model claims 100+ g of oil, it likely
    // mistook a sheen/drizzle for a pour.
    if (
      (nameMatchesAny(item.name, PURE_FAT_KEYWORDS) ||
        nameMatchesAny(item.name, SAUCE_DRESSING_KEYWORDS)) &&
      item.portionGrams > MAX_PLAUSIBLE_OIL_GRAMS
    ) {
      issues.push({
        code: "oil-portion-too-large",
        index: i,
        message: `${item.name}: ${item.portionGrams} g is implausibly large for an oil/sauce/dressing — typical visible portion is 5–30 g. Re-estimate the grams.`,
      });
    }

    // Rule 5: high-protein category (label says meat/fish/eggs but
    // macros say otherwise). Catch the model claiming chicken has
    // 50 g of fat per 100 g — usually means it confused the food.
    const PROTEIN_NAMES = [
      "chicken",
      "turkey",
      "beef",
      "pork",
      "lamb",
      "salmon",
      "tuna",
      "cod",
      "shrimp",
    ];
    if (nameMatchesAny(item.name, PROTEIN_NAMES)) {
      if (protein < 10) {
        issues.push({
          code: "fat-claimed-as-protein",
          index: i,
          message: `${item.name} is a meat/fish — should have ≥ 15 g protein per 100 g, you claimed ${protein}. Re-estimate.`,
        });
      }
    }
  }
  return issues;
}
