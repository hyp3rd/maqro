/** A grocery store found near the user via OpenStreetMap. */
export type NearbyStore = {
  /** Stable OSM key, `"<type>/<id>"` (e.g. "node/123"). */
  id: string;
  name: string;
  /** OSM `shop` tag value — "supermarket", "grocery", … — for a badge. */
  kind: string;
  lat: number;
  lon: number;
  /** Straight-line metres from the user (great-circle). */
  distanceM: number;
  address?: string;
};

/** OSM `shop` tag values we treat as "somewhere you can buy groceries".
 *  These are real `shop=` tag values (single tokens, underscore-joined);
 *  descriptive phrases like "grocery store" are NOT valid OSM values and
 *  would never match. `health_food` covers organic/bio shops, `deli`
 *  cold cuts, `farm` farm shops. */
const SHOP_KINDS = [
  "supermarket",
  "grocery",
  "convenience",
  "greengrocer",
  "health_food",
  "deli",
  "farm",
];

/** Build an Overpass QL query for grocery shops within `radiusM` of a
 *  point. `out center` makes ways/relations report a single coordinate
 *  so we can treat every result uniformly. The result cap keeps the
 *  payload (and our parse) bounded regardless of how dense the area is. */
export function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusM: number,
): string {
  const filter = SHOP_KINDS.join("|");
  const around = `${Math.round(radiusM)},${lat},${lon}`;
  return `[out:json][timeout:25];(node["shop"~"^(${filter})$"](around:${around});way["shop"~"^(${filter})$"](around:${around});relation["shop"~"^(${filter})$"](around:${around}););out center 60;`;
}

/** Great-circle distance in metres between two lat/lon points. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000; // Earth radius, metres.
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

/** Compose a one-line street address from the `addr:*` tags OSM exposes,
 *  if enough of them are present. Returns undefined when there's nothing
 *  useful to show. */
function addressFromTags(tags: Record<string, string>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const parts = [street, tags["addr:city"]].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Normalize a raw Overpass response into sorted, nearest-first stores.
 *  Nodes carry `lat`/`lon` directly; ways/relations carry a `center`
 *  (from `out center`). Unnamed shops are dropped (nothing to show or
 *  search), duplicates collapse by OSM id, and the list is sorted by
 *  distance from the user and capped to `limit`. Pure. */
export function parseOverpassResponse(
  json: unknown,
  userLat: number,
  userLon: number,
  limit: number,
): NearbyStore[] {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const byId = new Map<string, NearbyStore>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const id = `${el.type ?? "node"}/${el.id ?? `${lat},${lon}`}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name,
      kind: tags.shop ?? "store",
      lat,
      lon,
      distanceM: haversineMeters(userLat, userLon, lat, lon),
      address: addressFromTags(tags),
    });
  }
  return [...byId.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(0, limit));
}

/** Human distance: metres under 1 km ("850 m"), one-decimal km above
 *  ("1.2 km"). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Google Maps **directions** link from the user's location to the
 *  store, using the documented Maps URLs API
 *  (`/maps/dir/?api=1&origin=…&destination=…`). Walking mode, since
 *  these are "near you" results. When the origin is unknown (shouldn't
 *  happen — results only exist after a located/geocoded search) we omit
 *  it and Maps falls back to the device's current location. Coordinates
 *  route to the exact point regardless of how the store is named. */
export function storeDirectionsUrl(
  store: { lat: number; lon: number },
  origin: { lat: number; lon: number } | null,
): string {
  const parts = [
    "api=1",
    `destination=${store.lat},${store.lon}`,
    "travelmode=walking",
  ];
  if (origin) parts.splice(1, 0, `origin=${origin.lat},${origin.lon}`);
  return `https://maps.google.com/maps/dir/?${parts.join("&")}`;
}

/** A geocoded place suggestion: coordinates plus a human label (shown in
 *  the autocomplete dropdown and as the "near …" confirmation). `id` is
 *  a stable key for the list. */
export type GeocodeResult = {
  id: string;
  lat: number;
  lon: number;
  label: string;
};

/** Compose a readable one-line label from a Photon feature's properties.
 *  Photon splits an address across name/street/housenumber/city/state/
 *  country; we join the meaningful parts and drop consecutive repeats
 *  (the place `name` is often the same as the city). */
function geocodeLabel(p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const street = [s("housenumber"), s("street")].filter(Boolean).join(" ");
  const head = s("name") || street;
  const parts = [head, s("city") || s("county"), s("state"), s("country")]
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.filter((x, i) => x !== parts[i - 1]).join(", ");
}

/** Normalize a Photon (komoot) GeoJSON FeatureCollection into ranked
 *  place suggestions for autocomplete. Photon stores coordinates as
 *  `[lon, lat]`; we swap to our `{ lat, lon }`. Features without
 *  coordinates or a usable label are dropped. Pure. */
export function parseGeocodeResults(json: unknown, limit = 5): GeocodeResult[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: GeocodeResult[] = [];
  for (const f of features) {
    const feat = f as {
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: unknown };
    };
    const coords = feat.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      continue;
    }
    const props = feat.properties ?? {};
    const label = geocodeLabel(props);
    if (!label) continue;
    const osmType = props.osm_type;
    const osmId = props.osm_id;
    const id =
      osmType && osmId
        ? `${String(osmType)}/${String(osmId)}`
        : `${lat},${lon}`;
    out.push({ id, lat, lon, label });
    if (out.length >= limit) break;
  }
  return out;
}
