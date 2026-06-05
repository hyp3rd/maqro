import type { Food } from "@/components/macro/types";
import { cacheGet, cacheSetFireAndForget } from "@/lib/cache/redis";
import type { MicronutrientValues } from "@/lib/micronutrients/types";
import { MICRONUTRIENTS, type MicronutrientKey } from "@/lib/rda";

/** Server-side Open Food Facts search used by the AI meal-plan route as a
 * tool. Hits the upstream Search-a-licious endpoint directly (the
 * `/api/off-search` browser proxy adds CORS+cache for clients, neither
 * matters when we're already in a route handler). Returns `Food`-shaped
 * results so the AI route can splice them into the catalog the
 * `aiPlanToMeals` converter searches. */

const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v0/product";
// `nutriments` is the single rich object — requesting it pulls macros
// AND the micronutrient `_100g` fields the enrichment pipeline maps,
// so no extra field needs listing here.
const FIELDS = ["code", "product_name", "brands", "nutriments"].join(",");
// Raised from 10 to 25 so the `/api/off-search` proxy (which clamps to 25) can
// route through `searchOffHitsServer` without lowering its page size. The AI
// callers pass <= 10, so they're unaffected.
const MAX_LIMIT = 25;
const USER_AGENT = "maqro/0.1 (https://github.com/hyp3rd/maqro)";
const OFF_TIMEOUT_MS = 5_000;

// ─── Cross-instance cache (optional Upstash Redis) ──────────────────────────
// Bumping the version invalidates every cached entry at once after an `OFFHit`
// or `FIELDS` shape change.
const CACHE_VERSION = "v1";
const PRODUCT_TTL = 7 * 24 * 60 * 60; // 7d — per-100g macros are ~immutable
const PRODUCT_MISS_TTL = 6 * 60 * 60; // 6h — re-checks a missing barcode same-day
const SEARCH_TTL = 5 * 60; // 5m — search rankings are volatile
const MAX_CACHED_QUERY_LEN = 200; // don't store pathological keys
const productKey = (code: string) => `off:${CACHE_VERSION}:product:${code}`;
const searchKey = (q: string, limit: number) =>
  `off:${CACHE_VERSION}:search:${limit}:${q}`;

/** Negative-cache sentinel for a definitive OFF "no product" (`status: 0`). A
 *  truthy object, so `cacheGet` distinguishes it from a cache miss (`null`). */
type MissMarker = { __miss: true };
const MISS: MissMarker = { __miss: true };

/** Shape we extract from an Open Food Facts product blob. Exported so
 *  callers outside the search-a-licious path (the barcode route, mainly)
 *  can hand the inner product object straight to `hitToFood`. */
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
    // Micronutrients. OFF reports these `_100g` fields in base SI
    // grams regardless of the product's label units; the converter
    // below scales each to its canonical unit. Sodium is the only one
    // that's also a macro-ish field; the rest are genuine micros.
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

/** Maps a `MicronutrientKey` to its Open Food Facts `_100g` nutriment
 *  field name. Fiber reuses the field `hitToFood` already reads, so the
 *  same product blob feeds both the macro and micro paths. */
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
 *  response from /api/v0/product) to the local `Food` shape. Exported so
 *  the barcode-lookup route reuses the exact same normalization. */
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
    // Per-100g micronutrients captured at import time. Only attached
    // when OFF actually carried at least one — keeps the field absent
    // (not `{}`) for products with no micro data, so a downstream
    // `food.micronutrients` truthiness check reads cleanly.
    ...(() => {
      const micros = offHitToMicronutrients(h);
      return Object.keys(micros).length > 0 ? { micronutrients: micros } : {};
    })(),
  };
}

/** Per-nutrient median across multiple Open Food Facts products.
 *
 *  The enrichment cron uses this for a NAME search (a generic name
 *  like "chicken breast" returns many products). Taking the first
 *  hit's values let one mislabelled product define the nutrient; the
 *  median across the top hits is robust to that. For each nutrient we
 *  collect the non-null values across all hits and return their
 *  median — a nutrient absent from every hit stays absent (no
 *  misleading zero). An exact barcode lookup doesn't use this: it's a
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

/** Extract per-100g micronutrient values from an Open Food Facts
 *  product, normalized to each nutrient's canonical unit.
 *
 *  Separate from `hitToFood` on purpose: micronutrients are a Pro-only
 *  enrichment concern and shouldn't bloat the `Food` shape that every
 *  macro path carries. The cron calls this; the macro search path never
 *  touches it.
 *
 *  Each OFF `_100g` field is base-SI grams; we scale by the per-nutrient
 *  `offGramsToCanonical` factor from [lib/rda.ts](../rda.ts) (1 for
 *  fiber/g, 1000 for minerals/mg, 1e6 for trace vitamins/µg). Missing or
 *  non-finite values are dropped — `num()` guards each, and a nutrient
 *  absent from the product simply doesn't appear in the result. Returns
 *  an empty object when the product carries none of the ten. */
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

/** The outcome of a barcode lookup, as a discriminated union so HTTP callers
 *  (the `/api/off-barcode` route) can map each case to a precise status code —
 *  something the `OFFHit | null` shape can't express (it collapses timeout,
 *  not-found, and upstream error into a single `null`). */
export type OffProductResult =
  | { status: "hit"; product: OFFHit }
  | { status: "not_found" }
  | { status: "timeout" }
  | { status: "error" };

/** Fetch a single Open Food Facts product by barcode, server-side. Reads the
 *  shared cross-instance cache first; on a miss, fetches upstream and writes
 *  through — a confirmed `hit` (long TTL) or a definitive not-found (short
 *  negative TTL, so repeat scans of an unknown barcode don't re-hit OFF every
 *  time). Timeouts and upstream errors are NEVER cached (they're transient).
 *
 *  Mirrors the `/api/off-barcode` route's fetch but is callable from other
 *  server code (the enrichment cron) without an HTTP round-trip. Assumes a
 *  syntactically valid barcode; the route validates + 400s before calling. */
export async function fetchOffProductResult(
  code: string,
): Promise<OffProductResult> {
  const clean = code.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) return { status: "error" };
  const key = productKey(clean);

  const cached = await cacheGet<OFFHit | MissMarker>(key);
  if (cached) {
    return "__miss" in cached
      ? { status: "not_found" }
      : { status: "hit", product: cached };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(`${OFF_PRODUCT_URL}/${clean}.json`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { status?: 0 | 1; product?: OFFHit };
    if (data.status !== 1 || !data.product) {
      cacheSetFireAndForget(key, MISS, PRODUCT_MISS_TTL);
      return { status: "not_found" };
    }
    cacheSetFireAndForget(key, data.product, PRODUCT_TTL);
    return { status: "hit", product: data.product };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      return { status: "timeout" };
    }
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Barcode lookup as `OFFHit | null` — the shape the enrichment cron consumes
 *  (it treats not-found / timeout / error all as "no match" and moves on). Thin
 *  wrapper over {@link fetchOffProductResult} so the cron's call site is
 *  unchanged while the caching lives in one place. */
export async function fetchOffProductServer(
  code: string,
): Promise<OFFHit | null> {
  const result = await fetchOffProductResult(code);
  return result.status === "hit" ? result.product : null;
}

/** Search OFF, returning the raw `OFFHit[]`. The shared transport for
 *  both the `Food`-shaped macro path and the micronutrient path — the
 *  latter needs the untouched `nutriments` object, which `hitToFood`
 *  discards. Errors throw with a message the AI loop can surface. */
export async function searchOffHitsServer(
  query: string,
  limit: number = 10,
): Promise<OFFHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const key = searchKey(trimmed.toLowerCase(), clampedLimit);

  const cached = await cacheGet<OFFHit[]>(key);
  if (cached) return cached;

  const upstream = new URL(OFF_SEARCH_URL);
  upstream.searchParams.set("q", trimmed);
  upstream.searchParams.set("page_size", String(clampedLimit));
  upstream.searchParams.set("fields", FIELDS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
      // Cache short-lived: subsequent identical AI tool calls within the
      // same plan won't re-hit upstream.
      next: { revalidate: 60 },
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new Error("Open Food Facts search timed out after 5s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Open Food Facts search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { hits?: OFFHit[] };
  const hits = data.hits ?? [];
  // Write-through, fire-and-forget. Skip pathologically long queries so a junk
  // key can't bloat the cache (empty queries already returned above).
  if (trimmed.length <= MAX_CACHED_QUERY_LEN) {
    cacheSetFireAndForget(key, hits, SEARCH_TTL);
  }
  return hits;
}

/** Search OFF, returning normalized `Food[]`. Caller controls `limit`
 * (clamped to MAX_LIMIT). Errors throw with a message the AI loop can
 * surface back to the model. */
export async function searchOpenFoodFactsServer(
  query: string,
  limit: number = 10,
): Promise<Food[]> {
  const hits = await searchOffHitsServer(query, limit);
  return hits.map(hitToFood).filter((f): f is Food => f !== null);
}
