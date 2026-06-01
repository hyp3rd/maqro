import { parseGeocodeResults } from "@/lib/shopping/nearby";
import { NextResponse } from "next/server";

/** Server-side proxy to the Photon (komoot) geocoder — turns a typed
 *  address into ranked place suggestions so "stores near me" works
 *  without device geolocation and can autocomplete as the user types.
 *
 *  Photon is keyless and built for type-ahead. We proxy (rather than
 *  calling it from the browser) to keep the CSP `connect-src` tight
 *  ('self' only) and to send a polite `User-Agent`. Unauthenticated,
 *  mirroring [app/api/shopping/nearby/route.ts](../nearby/route.ts). The
 *  query is forwarded to Photon and never stored. */
const PHOTON_URL = "https://photon.komoot.io/api/";
const LIMIT = 5;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const upstream = new URL(PHOTON_URL);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", String(LIMIT));

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "maqro/0.1 (https://github.com/hyp3rd/maqro)",
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

  const results = parseGeocodeResults(await res.json(), LIMIT);
  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
