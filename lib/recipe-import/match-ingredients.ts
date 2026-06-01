import type { Food, RecipeIngredient } from "@/components/macro/types";
import { foodDatabase } from "@/data/food-database";
import { classifyFood } from "@/lib/diet";

/** Best-effort matcher: raw ingredient strings → catalog-resolved
 *  RecipeIngredient[].
 *
 *  Intended as the engine behind the import dialog's "try to match
 *  ingredients" toggle. Output is explicitly LOW-CONFIDENCE — each
 *  row carries a `confidence` band the UI surfaces as a per-row hint
 *  + a top-level disclaimer telling the user to verify before
 *  saving. We never invent macro values; everything comes from the
 *  catalog row we matched to.
 *
 *  Why not AI: the existing /api/recipes/generate Anthropic agent
 *  could do this more accurately, but it costs tokens, runs slowly
 *  (multiple round-trips), and isn't necessary for the "give me a
 *  starting point I'll fix" use case. The catalog-only matcher is
 *  fast, free, and right often enough for the dozen-or-so common
 *  staples that show up in most recipes. Edge ingredients
 *  (specialty cheeses, regional veg) fall back to `confidence:
 *  "none"` and the UI hides them from the matched set so the user
 *  knows they need manual addition. */

const DEFAULT_PORTION_GRAMS = 100;

/** Approximate gram weights for common volumetric and count units.
 *  These are intentionally rough — a "1 tbsp olive oil" is closer
 *  to 14 g than 15, but the precision lost by assuming a generic
 *  density is small relative to the imprecision of "to taste"
 *  measurements and the user's own portioning. The UI surfaces
 *  `confidence: "low"` on every volumetric parse so the user knows
 *  to sanity-check. */
const UNIT_GRAMS: Record<string, number> = {
  // Mass — exact.
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
  mg: 0.001,
  // Volume → mass at water density (a reasonable mid-range
  // approximation; users will adjust for oils/flours/etc.).
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  cup: 240,
  cups: 240,
  tbsp: 14,
  tablespoon: 14,
  tablespoons: 14,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  // Counted items — wildly variable, but a reasonable default.
  clove: 5,
  cloves: 5,
  leaf: 1,
  leaves: 1,
  slice: 20,
  slices: 20,
  piece: 30,
  pieces: 30,
};

/** Modifiers we strip from the ingredient name before searching
 *  the catalog. "Ground beef, lean" → "ground beef"; the post-
 *  comma qualifier rarely changes which catalog entry to match. */
const MODIFIER_SPLIT = /\s*[,(]/;

export type IngredientMatchConfidence = "exact" | "high" | "low" | "none";

export type IngredientMatchResult = {
  /** The original ingredient string as it appeared in the recipe. */
  original: string;
  /** The matched RecipeIngredient, or null if no catalog hit. */
  ingredient: RecipeIngredient | null;
  confidence: IngredientMatchConfidence;
  /** Human-readable note for the UI to surface alongside low-
   *  confidence matches ("Parsed cups → 240g — please verify"). */
  note?: string;
};

export function matchIngredients(raw: string[]): IngredientMatchResult[] {
  return raw.map(matchOne);
}

function matchOne(original: string): IngredientMatchResult {
  const cleaned = original.trim();
  if (!cleaned) {
    return { original, ingredient: null, confidence: "none" };
  }

  const parsed = parseIngredient(cleaned);
  const food = findCatalogMatch(parsed.name);
  if (!food) {
    return {
      original,
      ingredient: null,
      confidence: "none",
      note: "No catalog match — add manually.",
    };
  }

  // Confidence ladder. Unit imprecision dominates the confidence
  // signal — even an exact-name match against the catalog is "low"
  // if we had to guess at the gram conversion (volume / count /
  // no quantity at all). Mass-unit parses upgrade based on how
  // well the name matched.
  let confidence: IngredientMatchConfidence;
  let note: string | undefined;
  if (parsed.unitKind !== "mass") {
    confidence = "low";
    note =
      parsed.unitKind === "missing"
        ? `No quantity in source — defaulted to ${DEFAULT_PORTION_GRAMS}g`
        : `Parsed "${parsed.matchedToken}" — verify portion`;
  } else if (food.name.toLowerCase() === parsed.name.toLowerCase()) {
    confidence = "exact";
  } else {
    confidence = "high";
  }

  const portionGrams = clampPortion(parsed.grams);
  return {
    original,
    confidence,
    note,
    ingredient: {
      foodName: food.name,
      macrosPer100g: {
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        calories: food.calories,
      },
      portionGrams,
      dietKind: deriveDietKind(food),
    },
  };
}

type ParsedIngredient = {
  /** The grams-portion to feed into the RecipeIngredient. */
  grams: number;
  /** Cleaned name for catalog lookup. */
  name: string;
  /** What kind of unit we parsed — informs the confidence ladder. */
  unitKind: "mass" | "volume" | "count" | "missing";
  /** The raw unit token we matched (for the user-facing note). */
  matchedToken: string;
};

/** Extract `{ grams, name, unitKind }` from a freeform ingredient
 *  string. Examples:
 *    "500 g ground beef"         → 500, "ground beef", "mass"
 *    "2 cups flour"              → 480, "flour", "volume"
 *    "1 tbsp olive oil, extra"   → 14, "olive oil", "volume"
 *    "Salt to taste"             → 100 (default), "salt", "missing"
 *    "½ tsp baking soda"         → 2.5, "baking soda", "volume"
 *
 *  Regex-driven; not a full parser. We only need to get the
 *  90%-case right; the user reviews everything anyway. */
function parseIngredient(input: string): ParsedIngredient {
  // Strip any trailing modifier ("extra virgin", "to taste") before
  // tokenizing — those don't affect the quantity parse.
  const main = input.split(MODIFIER_SPLIT)[0]?.trim() ?? input.trim();

  // Quantity: leading integer, decimal, unicode fraction, or ASCII
  // fraction. Allow a few common shapes; bail on anything weird.
  const qtyMatch = main.match(/^([\d.]+(?:\s*\/\s*\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*/);
  let quantity = qtyMatch ? parseQuantity(qtyMatch[1] ?? "1") : NaN;
  const afterQty = qtyMatch ? main.slice(qtyMatch[0].length) : main;

  // Unit: first token after the quantity, if it's one we know.
  const tokens = afterQty.split(/\s+/);
  let unitToken = "";
  let nameStart = 0;
  if (tokens[0]) {
    const candidate = tokens[0].toLowerCase().replace(/[.,]$/, "");
    if (UNIT_GRAMS[candidate] !== undefined) {
      unitToken = candidate;
      nameStart = 1;
    }
  }
  const nameRaw = tokens.slice(nameStart).join(" ").trim();
  const name = cleanName(nameRaw);

  if (!unitToken && !Number.isFinite(quantity)) {
    // No quantity, no unit — likely a "Salt to taste" / "A pinch of"
    // line. Default-grammed; user adjusts.
    return {
      grams: DEFAULT_PORTION_GRAMS,
      name,
      unitKind: "missing",
      matchedToken: "",
    };
  }

  if (!Number.isFinite(quantity)) quantity = 1;
  if (!unitToken) {
    // We have a number but no recognized unit — assume grams. This
    // is wrong for "2 large eggs" (would resolve to 2g), but
    // there's no general way to distinguish from "2 grams salt"
    // without a real semantic parser. The user's review catches it.
    return {
      grams: quantity,
      name,
      unitKind: "mass",
      matchedToken: "g (assumed)",
    };
  }

  const grams = quantity * (UNIT_GRAMS[unitToken] ?? 1);
  const unitKind = classifyUnit(unitToken);
  return { grams, name, unitKind, matchedToken: unitToken };
}

const VOLUME_UNITS = new Set([
  "ml",
  "milliliter",
  "milliliters",
  "l",
  "liter",
  "liters",
  "cup",
  "cups",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
]);
const COUNT_UNITS = new Set([
  "clove",
  "cloves",
  "leaf",
  "leaves",
  "slice",
  "slices",
  "piece",
  "pieces",
]);

function classifyUnit(unit: string): "mass" | "volume" | "count" {
  if (VOLUME_UNITS.has(unit)) return "volume";
  if (COUNT_UNITS.has(unit)) return "count";
  return "mass";
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function parseQuantity(raw: string): number {
  const t = raw.trim();
  const unicodeFrac = UNICODE_FRACTIONS[t];
  if (unicodeFrac !== undefined) return unicodeFrac;
  const asciiFrac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (asciiFrac && asciiFrac[1] && asciiFrac[2]) {
    const n = parseInt(asciiFrac[1], 10);
    const d = parseInt(asciiFrac[2], 10);
    if (d > 0) return n / d;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** Lowercase + strip trailing punctuation + collapse whitespace. */
function cleanName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Score-then-pick the best catalog entry. We use a token-overlap
 *  score (intersect / union, à la Jaccard) which handles "ground
 *  beef" matching "Ground Beef" perfectly AND "lean ground beef"
 *  matching too. Names with zero overlap return null.
 *
 *  Threshold: at least one shared token AND >= 0.34 overlap. Below
 *  that, we'd be matching on too-generic words ("oil" matching
 *  every oil entry equally). The user benefits more from "no
 *  match" than from a probably-wrong match. */
function findCatalogMatch(name: string): Food | null {
  if (!name) return null;
  const queryTokens = tokenize(name);
  if (queryTokens.size === 0) return null;

  let best: { food: Food; score: number } | null = null;
  for (const food of foodDatabase) {
    const foodTokens = tokenize(food.name);
    const score = jaccard(queryTokens, foodTokens);
    if (score === 0) continue;
    if (!best || score > best.score) best = { food, score };
  }
  if (!best || best.score < 0.34) return null;
  return best.food;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function clampPortion(g: number): number {
  if (!Number.isFinite(g) || g <= 0) return DEFAULT_PORTION_GRAMS;
  // RecipeForm clamps to PORTION_MIN=5 and PORTION_MAX=500 already.
  // Keep them in sync so a matched portion of 800g (1 lb 12 oz)
  // doesn't fail validation later.
  return Math.max(5, Math.min(500, Math.round(g)));
}

function deriveDietKind(food: Food): RecipeIngredient["dietKind"] | undefined {
  if (food.dietKind) return food.dietKind;
  const k = classifyFood(food);
  return k === "unknown" ? undefined : k;
}
