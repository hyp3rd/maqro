import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/shopping/nearby${qs}`);
}

let fetchMock: ReturnType<typeof vi.fn>;

describe("/api/shopping/nearby GET", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns sorted nearby stores from the Overpass response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: "node",
            id: 1,
            lat: 51.52,
            lon: -0.12,
            tags: { name: "Far Mart", shop: "supermarket" },
          },
          {
            type: "node",
            id: 2,
            lat: 51.501,
            lon: -0.12,
            tags: { name: "Near Grocer", shop: "grocery" },
          },
        ],
      }),
    });

    const res = await GET(makeRequest("?lat=51.5&lon=-0.12"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { stores: { name: string }[] };
    expect(json.stores.map((s) => s.name)).toEqual(["Near Grocer", "Far Mart"]);

    // POSTs the Overpass query with a User-Agent.
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("overpass-api.de");
    expect(init.method).toBe("POST");
    expect(init.headers["User-Agent"]).toContain("maqro");
    expect(init.body).toContain("around%3A3000%2C51.5%2C-0.12");
  });

  it("clamps the radius into the allowed range", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    });
    await GET(makeRequest("?lat=51.5&lon=-0.12&radius=999999"));
    expect(fetchMock.mock.calls[0][1].body).toContain("around%3A10000%2C");
  });

  it("400s on missing or out-of-range coordinates", async () => {
    expect((await GET(makeRequest("?lat=51.5"))).status).toBe(400);
    expect((await GET(makeRequest("?lat=200&lon=0"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502s when Overpass fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 504 });
    const res = await GET(makeRequest("?lat=51.5&lon=-0.12"));
    expect(res.status).toBe(502);
  });

  it("502s when the fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await GET(makeRequest("?lat=51.5&lon=-0.12"));
    expect(res.status).toBe(502);
  });
});
