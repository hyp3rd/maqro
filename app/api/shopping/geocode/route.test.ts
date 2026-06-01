import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/shopping/geocode${qs}`);
}

let fetchMock: ReturnType<typeof vi.fn>;

describe("/api/shopping/geocode GET", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a query to ranked suggestions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            properties: {
              osm_type: "R",
              osm_id: 175342,
              name: "London",
              country: "United Kingdom",
            },
            geometry: { coordinates: [-0.1278, 51.5074] },
          },
        ],
      }),
    });
    const res = await GET(makeRequest("?q=London"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { lat: number; lon: number; label: string }[];
    };
    expect(json.results[0]).toMatchObject({
      lat: 51.5074,
      lon: -0.1278,
      label: "London, United Kingdom",
    });
    // Hits Photon with a User-Agent.
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("photon.komoot.io");
    expect(init.headers["User-Agent"]).toContain("macro-calculator");
  });

  it("returns empty results for a blank query without calling upstream", async () => {
    const res = await GET(makeRequest("?q=%20%20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty results when Photon finds nothing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    });
    const res = await GET(makeRequest("?q=asdfqwerzxcv"));
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([]);
  });

  it("502s when Photon fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const res = await GET(makeRequest("?q=London"));
    expect(res.status).toBe(502);
  });
});
