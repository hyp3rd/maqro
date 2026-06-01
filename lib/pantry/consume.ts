import { normalizeName } from "@/lib/ai/plan";
import type { PantryItem } from "@/lib/db";

/** At or below this quantity, a COUNT-unit item ("eggs", "cans") is
 *  "low" and worth alerting on. Mass-unit items ("kg", "g") use a
 *  relative rule instead — see `crossedLow` — because a fixed scalar
 *  can't serve both "1 egg left" and "1 kg left" (0.96 kg is not low).
 *  A per-item override could come later; one constant keeps v1
 *  predictable. */
export const LOW_STOCK_THRESHOLD = 1;

/** Grams in one of each recognized mass unit. The presence of a unit in
 *  this table is also how we decide an item is measured by weight (and
 *  so a gram-denominated recipe portion can be subtracted from it)
 *  rather than counted. Lower-cased + trimmed before lookup. Volume
 *  units live in `ML_PER_UNIT` instead — they reconcile grams via a
 *  per-item density (see `unitDecrement`). */
const GRAMS_PER_UNIT: Record<string, number> = {
  mg: 0.001,
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  gramme: 1,
  grammes: 1,
  kg: 1000,
  kgs: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

/** Grams in one of `unit`, or undefined when `unit` isn't a mass unit
 *  (a count or free-text unit like "eggs", "cans", "scoop", "ml"). */
function gramsPerUnit(unit: string): number | undefined {
  return GRAMS_PER_UNIT[unit.trim().toLowerCase()];
}

/** Millilitres in one of each recognized volume unit. Converting a
 *  gram-denominated recipe portion into a volume needs a density
 *  (g/ml) — taken per-item, defaulting to ~1 (water) when unset. */
const ML_PER_UNIT: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  milliliters: 1,
  millilitres: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  litre: 1000,
  liters: 1000,
  litres: 1000,
  tsp: 4.92892,
  teaspoon: 4.92892,
  teaspoons: 4.92892,
  tbsp: 14.7868,
  tablespoon: 14.7868,
  tablespoons: 14.7868,
  cup: 236.588,
  cups: 236.588,
  "fl oz": 29.5735,
};

/** Millilitres in one of `unit`, or undefined when it isn't a volume
 *  unit. */
function volumeUnitMl(unit: string): number | undefined {
  return ML_PER_UNIT[unit.trim().toLowerCase()];
}

/** True when `unit` is a recognized mass unit (g, kg, oz, …). */
export function isMassUnit(unit: string): boolean {
  return gramsPerUnit(unit) !== undefined;
}

/** True when `unit` is a recognized volume unit (ml, l, cup, tbsp, …). */
export function isVolumeUnit(unit: string): boolean {
  return volumeUnitMl(unit) !== undefined;
}

/** True when `unit` is a measure (mass or volume) rather than a count —
 *  i.e. a gram-denominated portion can be reconciled against it. Used to
 *  decide draw-down semantics and the low-stock rule. */
export function isMeasuredUnit(unit: string): boolean {
  return isMassUnit(unit) || isVolumeUnit(unit);
}

/** The default density (g/ml) used for a volume item when none is set —
 *  water-like. Exported so the editor can show it as the placeholder. */
export const DEFAULT_DENSITY_G_PER_ML = 1;

/** Round to 3 decimals (1 mg precision in kg, 1 g in g) so float drift
 *  from the gram conversion doesn't leave "0.9600000000000001 kg" in
 *  the store. Integer quantities (counts, whole grams) round to
 *  themselves. */
export function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Minimum normalized length for the word-boundary substring fallback,
 *  matching `SUBSTRING_MIN_LEN` in lib/ai/plan.ts so pantry matching has
 *  the exact same edge behavior as catalog matching ("egg" never
 *  matches "eggplant"). */
const SUBSTRING_MIN_LEN = 4;

/** Find the pantry item a consumed food name refers to, reusing the
 *  same normalize + word-boundary-substring semantics as
 *  `matchPick` (lib/ai/plan.ts). Exact normalized match wins; otherwise
 *  the shorter normalized name must appear as a whole word in the
 *  longer. Returns the first match (pantry lists are small and a
 *  duplicate-name pantry is a user problem we don't try to
 *  disambiguate). */
export function matchPantryItem(
  name: string,
  items: PantryItem[],
): PantryItem | undefined {
  const norm = normalizeName(name);
  if (!norm) return undefined;
  // Exact normalized match first.
  for (const item of items) {
    if (normalizeName(item.name) === norm) return item;
  }
  // Word-boundary substring fallback.
  const paddedNorm = ` ${norm} `;
  for (const item of items) {
    const iNorm = normalizeName(item.name);
    if (!iNorm) continue;
    if (Math.min(norm.length, iNorm.length) < SUBSTRING_MIN_LEN) continue;
    const paddedI = ` ${iNorm} `;
    if (paddedI.includes(paddedNorm) || paddedNorm.includes(paddedI)) {
      return item;
    }
  }
  return undefined;
}

/** A food being consumed by a recipe: its name (matched against pantry
 *  item names) plus the grams the recipe portion uses. The grams let us
 *  draw a weight-measured pantry item down by the real amount instead of
 *  a blind whole unit. */
export type ConsumedIngredient = {
  name: string;
  /** Grams used by this ingredient line (e.g. `RecipeIngredient.portionGrams`). */
  grams: number;
};

/** One planned decrement of a pantry item after a consume action. */
export type PantryConsumption = {
  item: PantryItem;
  /** Quantity after the decrement, floored at 0, in the item's own unit. */
  newQuantity: number;
  /** True iff this decrement just took the item across the low-stock
   *  line — the moment to alert. Already-low items don't re-trigger. */
  nowLow: boolean;
};

/** How much to subtract from an item, in the item's own unit, for one
 *  pass of the recipe.
 *
 *  - Mass items convert the consumed grams into their unit (40 g out of a
 *    1 kg bag → 0.04 kg).
 *  - Volume items convert grams → ml via `density` (g/ml, default ~1),
 *    then ml → the item's unit (250 g milk → 250 ml → 0.25 l).
 *  - Count / free-text items subtract one whole unit, since grams can't
 *    be reconciled with "eggs" or "cans". */
function unitDecrement(
  unit: string,
  gramsConsumed: number,
  density?: number,
): number {
  const perUnit = gramsPerUnit(unit);
  if (perUnit !== undefined) return gramsConsumed / perUnit;
  const mlPerUnit = volumeUnitMl(unit);
  if (mlPerUnit !== undefined) {
    const d =
      typeof density === "number" && density > 0
        ? density
        : DEFAULT_DENSITY_G_PER_ML;
    return gramsConsumed / d / mlPerUnit;
  }
  return 1;
}

/** Public, rounded form of `unitDecrement` for the meal-planner
 *  draw-down: how much to subtract from a pantry item, in its own unit,
 *  for a food using `grams` (× `times`), given the item's optional
 *  `density` (only used for volume units). Rounded to the store's
 *  precision so repeated add/edit cycles don't accrete float drift.
 *  Reuses the exact conversion the recipe Apply path uses. */
export function consumedUnitAmount(
  unit: string,
  grams: number,
  times = 1,
  density?: number,
): number {
  const step = Number.isFinite(times) && times > 0 ? times : 1;
  return roundQuantity(unitDecrement(unit, grams, density) * step);
}

/** Did this decrement just cross the item into "low"?
 *
 *  - With a per-item `threshold` set: crossed from `> threshold` to
 *    `<= threshold` (units don't matter — the user's number is
 *    authoritative).
 *  - Otherwise count / free-text units: crossed `LOW_STOCK_THRESHOLD`
 *    ("down to the last one").
 *  - Otherwise measured units (mass or volume): no universal "low"
 *    amount (1 kg of flour is plenty; 1 kg of saffron is a lifetime),
 *    so we use a self-calibrating rule — low when there's no longer
 *    enough left to repeat the same use again (or it just hit empty).
 *
 *  Firing only on the crossing keeps it from re-alerting on every
 *  subsequent use. */
export function crossedLow(
  unit: string,
  prevQuantity: number,
  newQuantity: number,
  decrement: number,
  threshold?: number,
): boolean {
  if (typeof threshold === "number" && threshold >= 0) {
    return prevQuantity > threshold && newQuantity <= threshold;
  }
  if (!isMeasuredUnit(unit)) {
    return (
      prevQuantity > LOW_STOCK_THRESHOLD && newQuantity <= LOW_STOCK_THRESHOLD
    );
  }
  if (decrement <= 0) return false;
  const ranOut = prevQuantity > 0 && newQuantity <= 0;
  const cantRepeat = prevQuantity >= decrement && newQuantity < decrement;
  return ranOut || cantRepeat;
}

/** Static "is this item currently low?" predicate for badges and
 *  list-time signals (unlike `crossedLow`, which only fires on the
 *  crossing event). Honours the per-item `lowThreshold` override; falls
 *  back to the same asymmetry as `pantryGapItems` — count items at or
 *  below the global threshold, measured items only when empty (no
 *  universal "low weight"). */
export function isLow(item: PantryItem): boolean {
  if (typeof item.lowThreshold === "number" && item.lowThreshold >= 0) {
    return item.quantity <= item.lowThreshold;
  }
  if (!isMeasuredUnit(item.unit)) return item.quantity <= LOW_STOCK_THRESHOLD;
  return item.quantity <= 0;
}

/** A computed draw-down for one consumed food: the pantry item it
 *  matched and how much (in that item's unit) it actually took — or
 *  `null` when the food matched nothing or the item was already empty.
 *  Stamped onto the meal `FoodItem` as `pantrySource` so removing or
 *  editing that food can restore / re-scale exactly what it drew. */
export type FoodDrawDown = { itemId: string; consumedQty: number } | null;

/** Attribute a pantry draw-down to each consumed food individually, so
 *  every meal food can carry its own restorable `pantrySource`.
 *
 *  - `foods`: the lines being consumed, each with a name and the grams
 *    that portion uses (a recipe's ingredients, today + every batch day,
 *    flattened — or a single manually-added food).
 *  - `items`: the current pantry.
 *  - `times`: passes (1 for a single cook). The batch case is normally
 *    expressed by passing one entry per day rather than `times`, but the
 *    multiplier is honored for callers that prefer it.
 *
 *  Walks the foods in order against a working copy of the pantry: each
 *  food draws only what's left after the earlier ones, so several foods
 *  matching the same item never together restore more than was taken,
 *  and the per-food amounts sum to the true total. Mass items convert
 *  grams; count / free-text items cost one whole unit per food per pass.
 *  Returns one entry per input food, positionally aligned. Pure: no I/O,
 *  no mutation of the inputs. */
export function planPerFoodConsumption(
  foods: ConsumedIngredient[],
  items: PantryItem[],
  times = 1,
): FoodDrawDown[] {
  const balance = new Map(items.map((i) => [i.id, i.quantity] as const));
  return planPerFoodConsumptionAgainstBalance(foods, items, balance, times);
}

/** Like {@link planPerFoodConsumption} but threads an external `balance`
 *  Map so successive calls share the same running pantry state. The
 *  multi-day recipe Apply uses this to attribute draw-down per day
 *  against the balance left after the previous successful day, and to
 *  bail out of attribution entirely for days whose meal slot doesn't
 *  match (those days never reach the pantry).
 *
 *  Mutates `balance` in place by subtracting each food's consumed
 *  quantity from the corresponding item id; callers can inspect or
 *  discard the post-call balance as they wish. */
export function planPerFoodConsumptionAgainstBalance(
  foods: ConsumedIngredient[],
  items: PantryItem[],
  balance: Map<string, number>,
  times = 1,
): FoodDrawDown[] {
  return foods.map((food) => {
    const matched = matchPantryItem(food.name, items);
    if (!matched) return null;
    const have = balance.get(matched.id) ?? 0;
    if (have <= 0) return null;
    const want = consumedUnitAmount(
      matched.unit,
      food.grams,
      times,
      matched.density,
    );
    const actual = roundQuantity(Math.min(want, have));
    if (actual <= 0) return null;
    balance.set(matched.id, roundQuantity(have - actual));
    return { itemId: matched.id, consumedQty: actual };
  });
}
