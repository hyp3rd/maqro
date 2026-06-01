import { describe, expect, it } from "vitest";
import {
  buildOverpassQuery,
  formatDistance,
  haversineMeters,
  parseGeocodeResults,
  parseOverpassResponse,
  storeDirectionsUrl,
  type NearbyStore,
} from "./nearby";

describe("buildOverpassQuery", () => {
  it("includes the shop filter, radius, and coordinates", () => {
    const q = buildOverpassQuery(51.5, -0.12, 3000);
    expect(q).toContain(
      "supermarket|grocery|convenience|greengrocer|health_food|deli|farm",
    );
    expect(q).toContain("around:3000,51.5,-0.12");
    expect(q).toContain("out center");
    // Queries both nodes and ways/relations.
    expect(q).toContain('node["shop"');
    expect(q).toContain('way["shop"');
  });
});

describe("haversineMeters", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMeters(51.5, -0.12, 51.5, -0.12)).toBeCloseTo(0, 5);
  });

  it("matches a known distance (~111 km per degree of latitude)", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("parseOverpassResponse", () => {
  const userLat = 51.5;
  const userLon = -0.12;

  it("normalizes nodes and ways, sorts nearest-first, drops unnamed", () => {
    const json = {
      elements: [
        // Farther node.
        {
          type: "node",
          id: 1,
          lat: 51.52,
          lon: -0.12,
          tags: { name: "Far Mart", shop: "supermarket" },
        },
        // Nearer way (uses center).
        {
          type: "way",
          id: 2,
          center: { lat: 51.501, lon: -0.12 },
          tags: {
            name: "Near Grocer",
            shop: "grocery",
            "addr:housenumber": "5",
            "addr:street": "High St",
            "addr:city": "London",
          },
        },
        // Unnamed → dropped.
        {
          type: "node",
          id: 3,
          lat: 51.5,
          lon: -0.12,
          tags: { shop: "grocery" },
        },
      ],
    };
    const stores = parseOverpassResponse(json, userLat, userLon, 15);
    expect(stores.map((s) => s.name)).toEqual(["Near Grocer", "Far Mart"]);
    expect(stores[0].id).toBe("way/2");
    expect(stores[0].address).toBe("5 High St, London");
    expect(stores[0].distanceM).toBeLessThan(stores[1].distanceM);
  });

  it("dedupes by OSM id and respects the limit", () => {
    const json = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 51.5,
          lon: -0.12,
          tags: { name: "A", shop: "convenience" },
        },
        {
          type: "node",
          id: 1,
          lat: 51.5,
          lon: -0.12,
          tags: { name: "A dup", shop: "convenience" },
        },
        {
          type: "node",
          id: 2,
          lat: 51.51,
          lon: -0.12,
          tags: { name: "B", shop: "supermarket" },
        },
      ],
    };
    const stores = parseOverpassResponse(json, userLat, userLon, 1);
    expect(stores).toHaveLength(1);
    expect(stores[0].name).toBe("A");
  });

  it("returns empty on a malformed payload", () => {
    expect(parseOverpassResponse({}, userLat, userLon, 15)).toEqual([]);
    expect(parseOverpassResponse(null, userLat, userLon, 15)).toEqual([]);
  });
});

describe("formatDistance", () => {
  it("uses metres under 1 km and km above", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(1234)).toBe("1.2 km");
  });
});

describe("storeDirectionsUrl", () => {
  const store: NearbyStore = {
    id: "node/1",
    name: "Joe's Market",
    kind: "supermarket",
    lat: 52.368633,
    lon: 4.8708484,
    distanceM: 100,
  };

  it("routes from the user's origin to the store (walking)", () => {
    expect(storeDirectionsUrl(store, { lat: 52.3500944, lon: 4.8446012 })).toBe(
      "https://maps.google.com/maps/dir/?api=1&origin=52.3500944,4.8446012&destination=52.368633,4.8708484&travelmode=walking",
    );
  });

  it("omits origin when unknown (Maps uses current location)", () => {
    expect(storeDirectionsUrl(store, null)).toBe(
      "https://maps.google.com/maps/dir/?api=1&destination=52.368633,4.8708484&travelmode=walking",
    );
  });
});

describe("parseGeocodeResults", () => {
  it("maps Photon features to suggestions, swapping [lon,lat]", () => {
    const results = parseGeocodeResults({
      features: [
        {
          properties: {
            osm_type: "R",
            osm_id: 175342,
            name: "London",
            state: "England",
            country: "United Kingdom",
          },
          geometry: { type: "Point", coordinates: [-0.1277653, 51.5074456] },
        },
        {
          properties: {
            housenumber: "10",
            street: "Downing Street",
            city: "London",
            country: "United Kingdom",
          },
          geometry: { type: "Point", coordinates: [-0.1276, 51.5034] },
        },
      ],
    });
    expect(results[0]).toEqual({
      id: "R/175342",
      lat: 51.5074456,
      lon: -0.1277653,
      label: "London, England, United Kingdom",
    });
    expect(results[1].label).toBe("10 Downing Street, London, United Kingdom");
  });

  it("respects the limit and drops featureless / unlabelled entries", () => {
    const results = parseGeocodeResults(
      {
        features: [
          {
            properties: { name: "A", country: "X" },
            geometry: { coordinates: [1, 2] },
          },
          { properties: {}, geometry: { coordinates: [3, 4] } }, // no label
          { properties: { name: "B" } }, // no geometry
          {
            properties: { name: "C", country: "Y" },
            geometry: { coordinates: [5, 6] },
          },
        ],
      },
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("A, X");
  });

  it("returns [] for empty or non-FeatureCollection payloads", () => {
    expect(parseGeocodeResults({ features: [] })).toEqual([]);
    expect(parseGeocodeResults(null)).toEqual([]);
    expect(parseGeocodeResults({})).toEqual([]);
  });

  it("skips out-of-range coordinates", () => {
    const results = parseGeocodeResults({
      features: [
        {
          properties: { name: "Bad", country: "Z" },
          geometry: { coordinates: [0, 200] },
        },
      ],
    });
    expect(results).toEqual([]);
  });
});
