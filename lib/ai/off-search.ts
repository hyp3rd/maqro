import type { Food } from "@/components/macro/types";
import { cacheGet, cacheSetFireAndForget } from "@/lib/cache/redis";
import { offCountryTag } from "@/lib/markets";
import {
  hitToFood,
  medianMicronutrients,
  offHitToMicronutrients,
  type OFFHit,
} from "@maqro/core/off";

// Re-export the pure OFF transforms (now in @maqro/core) so existing
// `@/lib/ai/off-search` importers — the barcode route, the enrichment cron — are
// unchanged.
export { hitToFood, medianMicronutrients, offHitToMicronutrients, type OFFHit };

/** Server-side Open Food Facts transport + the optional cross-instance cache.
 *  The pure product→`Food` / micronutrient transforms live in `@maqro/core/off`
 *  (re-exported above). Hits the upstream Search-a-licious endpoint directly
 *  (the `/api/off-search` browser proxy adds CORS for clients, which doesn't
 *  matter when we're already in a route handler) and returns `Food`-shaped
 *  results the AI route can splice into the catalog `aiPlanToMeals` searches. */

const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v0/product";
// `nutriments` is the single rich object — requesting it pulls macros AND the
// micronutrient `_100g` fields the enrichment pipeline maps, so no extra field
// needs listing here.
const FIELDS = ["code", "product_name", "brands", "nutriments"].join(",");
// The page size we request from upstream AND the hard ceiling on any caller's
// limit. We always fetch this many and cache the superset, then slice to the
// caller's limit — so the browser proxy (up to 25), the AI tools (<= 5), and the
// cron (10) share ONE cached entry per query instead of fragmenting by page size.
const MAX_LIMIT = 25;
const USER_AGENT = "maqro/0.1 (https://github.com/hyp3rd/maqro)";
const OFF_TIMEOUT_MS = 5_000;

// ─── Cross-instance cache (optional Upstash Redis) ──────────────────────────
// Bumping the version invalidates every cached entry at once after an `OFFHit`,
// `FIELDS`, or cache-value-shape change.
const CACHE_VERSION = "v2";
const PRODUCT_TTL = 7 * 24 * 60 * 60; // 7d — per-100g macros are ~immutable
const PRODUCT_MISS_TTL = 60 * 60; // 1h — bounds staleness if OFF transiently 404s
const SEARCH_TTL = 5 * 60; // 5m — search rankings are volatile
const MAX_CACHED_QUERY_LEN = 200; // don't store pathological keys
const productKey = (code: string) => `off:${CACHE_VERSION}:product:${code}`;
// Limit-independent: the cached value is the full superset, sliced per caller.
// Market-scoped when biased; `"world"` keeps the original (market-less)
// namespace so previously-cached global entries aren't orphaned.
const searchKey = (q: string, market: string) =>
  market && market !== "world"
    ? `off:${CACHE_VERSION}:search:${market.toLowerCase()}:${q}`
    : `off:${CACHE_VERSION}:search:${q}`;

/** Cross-instance cache entry for a barcode lookup. An explicit envelope so a
 *  negative result (`miss`) is provably disjoint from a real OFF product —
 *  which, as crowd-sourced JSON, could in principle carry any field name. */
type ProductCacheEntry = { hit: OFFHit } | { miss: true };

/** Shared Open Food Facts transport: a `fetch` with the standard headers, a 5s
 *  timeout, and optional propagation of a caller's `AbortSignal` (so a cancelled
 *  browser request aborts the upstream call instead of running to the timeout).
 *  On either a timeout or an external abort the underlying `fetch` rejects with
 *  an `AbortError`, which callers map to their own timeout outcome. */
async function offFetch(
  url: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  if (externalSignal?.aborted) controller.abort();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
      // Per-instance backstop cache, independent of the cross-instance Redis layer.
      next: { revalidate: 60 },
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/** The outcome of a barcode lookup, as a discriminated union so HTTP callers
 *  (the `/api/off-barcode` route) can map each case to a precise status code —
 *  something the `OFFHit | null` shape can't express (it collapses timeout,
 *  not-found, and upstream error into a single `null`). `detail` carries an
 *  upstream-failure hint for the 502 body (diagnostic, never shown to users). */
export type OffProductResult =
  | { status: "hit"; product: OFFHit }
  | { status: "not_found" }
  | { status: "timeout" }
  | { status: "error"; detail?: string };

/** Fetch a single Open Food Facts product by barcode, server-side. Reads the
 *  shared cross-instance cache first; on a miss, fetches upstream and writes
 *  through — a confirmed `hit` (long TTL) or a definitive not-found (short
 *  negative TTL, so repeat scans of an unknown barcode don't re-hit OFF every
 *  time). Timeouts and upstream errors are NEVER cached (they're transient).
 *  Pass `signal` to have a cancelled caller abort the upstream fetch.
 *
 *  Callable from other server code (the enrichment cron) without an HTTP
 *  round-trip. A syntactically invalid barcode is treated as `not_found`. */
export async function fetchOffProductResult(
  code: string,
  signal?: AbortSignal,
): Promise<OffProductResult> {
  const clean = code.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) return { status: "not_found" };
  const key = productKey(clean);

  const cached = await cacheGet<ProductCacheEntry>(key);
  if (cached && typeof cached === "object") {
    return "miss" in cached
      ? { status: "not_found" }
      : { status: "hit", product: cached.hit };
  }

  try {
    const res = await offFetch(`${OFF_PRODUCT_URL}/${clean}.json`, signal);
    if (!res.ok) {
      return { status: "error", detail: `upstream HTTP ${res.status}` };
    }
    let data: { status?: 0 | 1; product?: OFFHit };
    try {
      data = (await res.json()) as { status?: 0 | 1; product?: OFFHit };
    } catch {
      return { status: "error", detail: "malformed upstream response" };
    }
    if (data.status !== 1 || !data.product) {
      cacheSetFireAndForget(key, { miss: true }, PRODUCT_MISS_TTL);
      return { status: "not_found" };
    }
    cacheSetFireAndForget(key, { hit: data.product }, PRODUCT_TTL);
    return { status: "hit", product: data.product };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "timeout" };
    }
    return {
      status: "error",
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

/** One OFF search-a-licious query (optionally country-biased), returning the raw
 *  hits. `countryTag` appends a `countries_tags:"…"` filter to the query;
 *  `null` is an unbiased global search. */
async function fetchOffSearch(
  query: string,
  countryTag: string | null,
  signal?: AbortSignal,
): Promise<OFFHit[]> {
  const upstream = new URL(OFF_SEARCH_URL);
  // The tag value contains a colon (`en:germany`), so it must be quoted or the
  // Lucene parser splits on it. Appended to `q` rather than a separate param —
  // the search-a-licious `/search` endpoint filters through the query language.
  upstream.searchParams.set(
    "q",
    countryTag ? `${query} countries_tags:"${countryTag}"` : query,
  );
  upstream.searchParams.set("page_size", String(MAX_LIMIT));
  upstream.searchParams.set("fields", FIELDS);

  let res: Response;
  try {
    res = await offFetch(upstream.toString(), signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Open Food Facts search timed out after 5s");
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Open Food Facts search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { hits?: OFFHit[] };
  return data.hits ?? [];
}

/** Append `secondary` hits not already in `primary` (deduped by code), order
 *  preserved — `primary` (the country-biased hits) stays first. */
function mergeByCode(primary: OFFHit[], secondary: OFFHit[]): OFFHit[] {
  const seen = new Set(primary.map((h) => h.code).filter(Boolean));
  const out = [...primary];
  for (const h of secondary) {
    if (h.code && seen.has(h.code)) continue;
    if (h.code) seen.add(h.code);
    out.push(h);
  }
  return out;
}

/** Search OFF, returning the raw `OFFHit[]`. The shared transport for both the
 *  `Food`-shaped macro path and the micronutrient path — the latter needs the
 *  untouched `nutriments` object, which `hitToFood` discards. Pass `signal` to
 *  have a cancelled caller (e.g. a superseded typeahead request) abort the
 *  upstream fetch. Errors throw with a message the AI loop can surface.
 *
 *  `market` (an ISO market code, e.g. `DE`) biases results toward that country:
 *  the country-tagged query runs first, and — because OFF's country tagging is
 *  incomplete — a global query backfills (deduped) when the market is thinner
 *  than asked, so a bias never *hides* a relevant product. `"world"`/unset is
 *  today's global search, byte-for-byte.
 *
 *  Caches the full `MAX_LIMIT`-sized superset under a market-scoped, otherwise
 *  limit-independent key and returns the caller's `limit`-sized slice. */
export async function searchOffHitsServer(
  query: string,
  limit: number = 10,
  signal?: AbortSignal,
  market: string = "world",
): Promise<OFFHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const countryTag = offCountryTag(market);
  const key = searchKey(trimmed.toLowerCase(), countryTag ? market : "world");

  const cached = await cacheGet<OFFHit[]>(key);
  if (cached) return cached.slice(0, clampedLimit);

  let hits = await fetchOffSearch(trimmed, countryTag, signal);
  // Backfill from a global query when the country query is thinner than asked.
  if (countryTag && hits.length < clampedLimit) {
    const global = await fetchOffSearch(trimmed, null, signal);
    hits = mergeByCode(hits, global).slice(0, MAX_LIMIT);
  }

  // Write-through the full superset (fire-and-forget). Skip pathologically long
  // queries so a junk key can't bloat the cache (empty queries returned above).
  if (trimmed.length <= MAX_CACHED_QUERY_LEN) {
    cacheSetFireAndForget(key, hits, SEARCH_TTL);
  }
  return hits.slice(0, clampedLimit);
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
