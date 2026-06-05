import {
  MICRONUTRIENTS,
  type MicronutrientKey,
  type MicronutrientValues,
} from "./rda";
import type { Food } from "./types";

/** Open Food Facts product → local domain transforms. Pure (no fetch, no
 *  cache), so they're shared by the web server helpers, the enrichment cron, and
 *  the native app. The server transport + the cross-instance cache live in
 *  `@/lib/ai/off-search`. */

/** Shape we extract from an Open Food Facts product blob. Exported so callers
 *  outside the search-a-licious path (the barcode route, mainly) can hand the
 *  inner product object straight to `hitToFood`. */
export type OFFHit = {
  code?: string;
  product_name?: string;
  brands?: string | string[];
  nutriments?: {
    "energy-kcal_100g"?: number;
    "energy-kcal"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    sugars_100g?: number;
    "sugars-added_100g"?: number;
    fiber_100g?: number;
    "saturated-fat_100g"?: number;
    "trans-fat_100g"?: number;
    "monounsaturated-fat_100g"?: number;
    "polyunsaturated-fat_100g"?: number;
    // Micronutrients. OFF reports these `_100g` fields in base SI grams
    // regardless of the product's label units; the converter below scales each
    // to its canonical unit. Sodium is the only one that's also a macro-ish
    // field; the rest are genuine micros.
    sodium_100g?: number;
    potassium_100g?: number;
    calcium_100g?: number;
    iron_100g?: number;
    magnesium_100g?: number;
    zinc_100g?: number;
    "vitamin-c_100g"?: number;
    "vitamin-d_100g"?: number;
    "vitamin-b12_100g"?: number;
  };
};

/** Maps a `MicronutrientKey` to its Open Food Facts `_100g` nutriment field
 *  name. Fiber reuses the field `hitToFood` already reads, so the same product
 *  blob feeds both the macro and micro paths. */
const OFF_MICRONUTRIENT_FIELD: Record<
  MicronutrientKey,
  keyof NonNullable<OFFHit["nutriments"]>
> = {
  fiber: "fiber_100g",
  sodium: "sodium_100g",
  potassium: "potassium_100g",
  calcium: "calcium_100g",
  iron: "iron_100g",
  magnesium: "magnesium_100g",
  zinc: "zinc_100g",
  vitaminC: "vitamin-c_100g",
  vitaminD: "vitamin-d_100g",
  vitaminB12: "vitamin-b12_100g",
};

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function firstBrand(brands: string | string[] | undefined): string | undefined {
  if (!brands) return undefined;
  if (Array.isArray(brands)) return brands[0]?.trim() || undefined;
  return brands.split(",")[0]?.trim() || undefined;
}

/** Map an Open Food Facts product (either a search hit or a single-product
 *  response from /api/v0/product) to the local `Food` shape. Exported so the
 *  barcode-lookup route reuses the exact same normalization. */
export function hitToFood(h: OFFHit): Food | null {
  const name = (h.product_name ?? "").trim();
  if (!name) return null;
  const n = h.nutriments ?? {};
  const protein = num(n.proteins_100g);
  const carbs = num(n.carbohydrates_100g);
  const fat = num(n.fat_100g);
  const calories = num(n["energy-kcal_100g"]) ?? num(n["energy-kcal"]);
  // Drop anything missing macros — we can't rely on the AI guessing them.
  if (protein === undefined && carbs === undefined && fat === undefined) {
    return null;
  }
  return {
    id: `off:${h.code ?? name}`,
    source: "off",
    name,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    calories:
      calories ??
      Math.round((protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9),
    brand: firstBrand(h.brands),
    sugars: num(n.sugars_100g),
    addedSugars: num(n["sugars-added_100g"]),
    fiber: num(n.fiber_100g),
    saturatedFat: num(n["saturated-fat_100g"]),
    transFat: num(n["trans-fat_100g"]),
    monoFat: num(n["monounsaturated-fat_100g"]),
    polyFat: num(n["polyunsaturated-fat_100g"]),
    // Per-100g micronutrients captured at import time. Only attached when OFF
    // actually carried at least one — keeps the field absent (not `{}`) for
    // products with no micro data, so a downstream `food.micronutrients`
    // truthiness check reads cleanly.
    ...(() => {
      const micros = offHitToMicronutrients(h);
      return Object.keys(micros).length > 0 ? { micronutrients: micros } : {};
    })(),
  };
}

/** Per-nutrient median across multiple Open Food Facts products.
 *
 *  The enrichment cron uses this for a NAME search (a generic name like
 *  "chicken breast" returns many products). Taking the first hit's values lets
 *  one mislabelled product define the nutrient; the median across the top hits
 *  is robust to that. For each nutrient we collect the non-null values across
 *  all hits and return their median — a nutrient absent from every hit stays
 *  absent (no misleading zero). An exact barcode lookup doesn't use this: it's a
 *  single, specific product, so its own values are authoritative. */
export function medianMicronutrients(hits: OFFHit[]): MicronutrientValues {
  const buckets = new Map<MicronutrientKey, number[]>();
  for (const hit of hits) {
    const micros = offHitToMicronutrients(hit);
    for (const key of Object.keys(micros) as MicronutrientKey[]) {
      const v = micros[key];
      if (typeof v === "number") {
        const arr = buckets.get(key) ?? [];
        arr.push(v);
        buckets.set(key, arr);
      }
    }
  }
  const out: MicronutrientValues = {};
  for (const [key, values] of buckets) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    out[key] =
      values.length % 2 === 0
        ? (values[mid - 1] + values[mid]) / 2
        : values[mid];
  }
  return out;
}

/** Extract per-100g micronutrient values from an Open Food Facts product,
 *  normalized to each nutrient's canonical unit.
 *
 *  Separate from `hitToFood` on purpose: micronutrients are a Pro-only
 *  enrichment concern and shouldn't bloat the `Food` shape that every macro
 *  path carries. The cron calls this; the macro search path never touches it.
 *
 *  Each OFF `_100g` field is base-SI grams; we scale by the per-nutrient
 *  `offGramsToCanonical` factor from `./rda` (1 for fiber/g, 1000 for
 *  minerals/mg, 1e6 for trace vitamins/µg). Missing or non-finite values are
 *  dropped — `num()` guards each, and a nutrient absent from the product simply
 *  doesn't appear in the result. Returns an empty object when the product
 *  carries none of the ten. */
export function offHitToMicronutrients(h: OFFHit): MicronutrientValues {
  const n = h.nutriments ?? {};
  const out: MicronutrientValues = {};
  for (const key of Object.keys(MICRONUTRIENTS) as MicronutrientKey[]) {
    const raw = num(n[OFF_MICRONUTRIENT_FIELD[key]]);
    if (raw === undefined) continue;
    out[key] = raw * MICRONUTRIENTS[key].offGramsToCanonical;
  }
  return out;
}
