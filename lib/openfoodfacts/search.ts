import type { Food } from "@/components/macro/types";

/** Server-side OpenFoodFacts search. Same upstream + headers as
 * `app/api/off-search/route.ts` so we share rate-limit etiquette; lives
 * here so the meal-plan route can call OFF directly from within an AI
 * tool-runner loop without bouncing through our own /api/off-search. */
const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const FIELDS = ["code", "product_name", "brands", "nutriments"].join(",");
const MAX_PAGE_SIZE = 10;

type Nutriments = {
  "energy-kcal_100g"?: number;
  energy_100g?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
};

type OffHit = {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Nutriments;
};

/** Hits the OFF Search-a-licious API and converts results into the local
 * `Food` shape. Drops products without complete macro data — incomplete
 * rows would just confuse the AI planner. */
export async function searchOpenFoodFacts(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<Food[]> {
  const q = query.trim();
  if (!q) return [];

  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
  const upstream = new URL(OFF_SEARCH_URL);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("page_size", String(safeLimit));
  upstream.searchParams.set("fields", FIELDS);

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "macro-calculator/0.1 (https://github.com/hyp3rd/macro-calculator)",
      },
      signal,
      // Edge runtime: don't hold up the AI loop too long if OFF is slow.
      // Anthropic-side tool invocations have their own timeout but we
      // shouldn't compound. 6s is generous for a search API.
      cache: "no-store",
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json().catch(() => ({}))) as { hits?: OffHit[] };
  const hits = data.hits ?? [];

  const foods: Food[] = [];
  for (const hit of hits) {
    const name = hit.product_name?.trim();
    if (!name) continue;
    const n = hit.nutriments ?? {};
    const protein = n.proteins_100g;
    const carbs = n.carbohydrates_100g;
    const fat = n.fat_100g;
    // OFF reports calories two ways; prefer the kcal field, fall back to
    // kJ ÷ 4.184. Skip entirely if neither macros nor calories are present.
    const caloriesRaw =
      n["energy-kcal_100g"] ??
      (n.energy_100g ? n.energy_100g / 4.184 : undefined);
    if (
      protein === undefined ||
      carbs === undefined ||
      fat === undefined ||
      caloriesRaw === undefined
    ) {
      continue;
    }
    foods.push({
      id: hit.code ?? `off:${name.toLowerCase()}`,
      source: "off",
      name,
      protein: Number.parseFloat(protein.toFixed(1)),
      carbs: Number.parseFloat(carbs.toFixed(1)),
      fat: Number.parseFloat(fat.toFixed(1)),
      calories: Math.round(caloriesRaw),
      brand: hit.brands?.split(",")[0]?.trim() || undefined,
    });
  }
  return foods;
}
