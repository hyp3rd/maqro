import type { Food } from "@/components/macro/types";

/** Same-origin proxy to OFF's Search-a-licious endpoint. We can't call OFF
 * directly from the browser because the upstream doesn't send
 * Access-Control-Allow-Origin; the proxy is implemented at
 * `app/api/off-search/route.ts`. */
const OFF_PROXY_URL = "/api/off-search";

/** Subset of an OFF "hit" we care about. The API returns many more fields
 * (eco-score, images, etc.); we ignore them. */
type OFFHit = {
  code?: string;
  product_name?: string;
  /** New API returns an array; legacy/some hits still return a string. */
  brands?: string | string[];
  nutriments?: {
    "energy-kcal_100g"?: number;
    "energy-kcal"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    // Optional macro-breakdown fields. Many OFF entries don't fill
    // these — the mapper treats `undefined` as "unknown" rather than
    // zero so the UI can hide the row instead of showing misleading
    // "0g" values.
    sugars_100g?: number;
    "sugars-added_100g"?: number;
    fiber_100g?: number;
    "saturated-fat_100g"?: number;
    "trans-fat_100g"?: number;
    "monounsaturated-fat_100g"?: number;
    "polyunsaturated-fat_100g"?: number;
  };
};

type OFFSearchResponse = { hits?: OFFHit[]; count?: number };

/** Search Open Food Facts. Pass an AbortSignal so a stale query can cancel.
 * Returns foods normalized to per-100g; products missing the macros we need
 * are silently dropped — better than rendering NaNs. */
export async function searchOpenFoodFacts(
  query: string,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<Food[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(options.limit ?? 10),
  });
  const res = await fetch(`${OFF_PROXY_URL}?${params}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OFF search failed: ${res.status}`);
  }

  const data = (await res.json()) as OFFSearchResponse;
  const hits = data.hits ?? [];
  return hits.map(normalizeOFFHit).filter((f): f is Food => f !== null);
}

function firstBrand(brands: string | string[] | undefined): string | undefined {
  if (!brands) return undefined;
  if (Array.isArray(brands)) return brands[0]?.trim() || undefined;
  return brands.split(",")[0]?.trim() || undefined;
}

function normalizeOFFHit(h: OFFHit): Food | null {
  const name = (h.product_name ?? "").trim();
  if (!name) return null;

  const n = h.nutriments ?? {};
  const protein = num(n.proteins_100g);
  const carbs = num(n.carbohydrates_100g);
  const fat = num(n.fat_100g);
  const calories = num(n["energy-kcal_100g"]) ?? num(n["energy-kcal"]);

  if (
    protein === undefined &&
    carbs === undefined &&
    fat === undefined &&
    calories === undefined
  ) {
    return null;
  }

  const brand = firstBrand(h.brands);
  const p100 = protein ?? 0;
  const c100 = carbs ?? 0;
  const f100 = fat ?? 0;
  return {
    id: `off:${h.code ?? name}`,
    source: "off",
    name: brand ? `${name} (${brand})` : name,
    protein: p100,
    carbs: c100,
    fat: f100,
    calories: calories ?? p100 * 4 + c100 * 4 + f100 * 9,
    brand,
    // Macro-breakdown — undefined when OFF didn't supply it; the UI
    // hides rows where every food's value is undefined.
    sugars: num(n.sugars_100g),
    addedSugars: num(n["sugars-added_100g"]),
    fiber: num(n.fiber_100g),
    saturatedFat: num(n["saturated-fat_100g"]),
    transFat: num(n["trans-fat_100g"]),
    monoFat: num(n["monounsaturated-fat_100g"]),
    polyFat: num(n["polyunsaturated-fat_100g"]),
  };
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number.parseFloat(v);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
