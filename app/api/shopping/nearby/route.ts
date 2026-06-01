import {
  buildOverpassQuery,
  parseOverpassResponse,
} from "@/lib/shopping/nearby";
import { NextResponse } from "next/server";

/** Server-side proxy to the OpenStreetMap Overpass API for nearby
 *  grocery stores. A proxy (not a direct browser call) so we can send a
 *  proper `User-Agent` (OSM etiquette, which browsers can't set) and add
 *  a short edge cache. Keyless and unauthenticated — it touches no user
 *  data and works in guest mode, mirroring
 *  [app/api/off-search/route.ts](../../off-search/route.ts). The caller's
 *  coordinates are forwarded to Overpass and never stored. */
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_RADIUS_M = 3000;
const MIN_RADIUS_M = 500;
const MAX_RADIUS_M = 10_000;
const DEFAULT_RESULT_LIMIT = 15;
const MAX_RESULT_LIMIT = 100;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // `Number(null)` is 0, so a missing param must map to NaN explicitly —
  // otherwise an absent lon would validate as 0 and an absent radius
  // would clamp to the minimum instead of defaulting.
  const num = (key: string): number => {
    const raw = url.searchParams.get(key);
    return raw === null ? Number.NaN : Number(raw);
  };
  const lat = num("lat");
  const lon = num("lon");
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json(
      { error: "Valid lat and lon are required." },
      { status: 400 },
    );
  }

  const requestedRadius = num("radius");
  const radius = Number.isFinite(requestedRadius)
    ? Math.min(Math.max(requestedRadius, MIN_RADIUS_M), MAX_RADIUS_M)
    : DEFAULT_RADIUS_M;

  // `?limit=` lets the client request more than the default 15
  // results — used by the Stores Near You "Load more" path. Clamped
  // to MAX_RESULT_LIMIT to bound how many Overpass items we slice
  // server-side (Overpass returns the full radius set regardless;
  // the slice is just to keep payloads sane).
  const requestedLimit = num("limit");
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_RESULT_LIMIT)
    : DEFAULT_RESULT_LIMIT;

  let res: Response;
  try {
    res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "macro-calculator/0.1 (https://github.com/hyp3rd/macro-calculator)",
      },
      body: `data=${encodeURIComponent(buildOverpassQuery(lat, lon, radius))}`,
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

  const data = await res.json();
  const stores = parseOverpassResponse(data, lat, lon, resultLimit);
  return NextResponse.json(
    { stores },
    {
      headers: {
        // Short, location-specific cache — long enough to absorb a retry
        // or two without re-hitting Overpass, short enough to stay fresh.
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    },
  );
}
