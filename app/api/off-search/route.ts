import { NextResponse } from "next/server";

/** Server-side proxy to Open Food Facts' Search-a-licious endpoint. Necessary
 * because the OFF endpoint does not send Access-Control-Allow-Origin, so
 * browsers can't fetch it cross-origin. Same-origin proxy + short edge cache
 * also reduces upstream load. */
const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const FIELDS = ["code", "product_name", "brands", "nutriments"].join(",");
const MAX_PAGE_SIZE = 25;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ hits: [] });
  }

  const requested = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(1, requested), MAX_PAGE_SIZE)
    : 10;

  const upstream = new URL(OFF_SEARCH_URL);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("page_size", String(limit));
  upstream.searchParams.set("fields", FIELDS);

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "macro-calculator/0.1 (https://github.com/hyp3rd/macro-calculator)",
      },
      signal: request.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { hits?: unknown };
  return NextResponse.json(
    { hits: data.hits ?? [] },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
