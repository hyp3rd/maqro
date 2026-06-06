import type { Food } from "@/components/macro/types";

/** Lazy access to the ANSES-CIQUAL generic-food dataset (~3.2k foods).
 *
 *  The data is served as a static asset from `public/ciqual-database.json` and
 *  fetched on first use — it never enters the JS bundle — then cached for the
 *  session. Search is a name match, prefix hits first, tagged `source:
 *  "ciqual"`. Source: ANSES-CIQUAL 2020, Etalab Open Licence; regenerate with
 *  scripts/build-ciqual.py. */

const CIQUAL_URL = "/ciqual-database.json";

let cache: Food[] | null = null;
let inflight: Promise<Food[]> | null = null;

function load(): Promise<Food[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(CIQUAL_URL)
      .then((res) => (res.ok ? (res.json() as Promise<Food[]>) : []))
      .then((data) => {
        cache = data;
        return data;
      })
      .catch(() => {
        inflight = null; // allow a retry after a transient failure
        return [];
      });
  }
  return inflight;
}

/** Name-match the CIQUAL dataset, prefix hits first. Returns up to `limit` foods
 *  tagged `source: "ciqual"`. Resolves to `[]` when the dataset can't be fetched
 *  — the food search just degrades to its other sources. */
export async function searchCiqual(
  query: string,
  limit: number,
): Promise<Food[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const foods = await load();
  const starts: Food[] = [];
  const contains: Food[] = [];
  for (const f of foods) {
    const at = f.name.toLowerCase().indexOf(q);
    if (at === 0) starts.push(f);
    else if (at > 0) contains.push(f);
    if (starts.length >= limit) break; // enough prefix matches to fill the slice
  }
  return [...starts, ...contains]
    .slice(0, limit)
    .map((f) => ({ ...f, source: "ciqual" as const }));
}

/** Test seam: drop the in-memory cache so a spec can re-stub `fetch`. */
export function __resetCiqualCacheForTests(): void {
  cache = null;
  inflight = null;
}
