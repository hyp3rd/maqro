import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCiqualCacheForTests, searchCiqual } from "./ciqual";

const DATA = [
  {
    id: "ciqual:1",
    name: "Milk, whole",
    calories: 64,
    protein: 3.2,
    carbs: 4.8,
    fat: 3.6,
  },
  {
    id: "ciqual:2",
    name: "Buttermilk",
    calories: 40,
    protein: 3.3,
    carbs: 4.7,
    fat: 0.9,
  },
  {
    id: "ciqual:3",
    name: "Milk chocolate",
    calories: 535,
    protein: 7.3,
    carbs: 59,
    fat: 30,
  },
  {
    id: "ciqual:4",
    name: "Lentil, cooked",
    calories: 116,
    protein: 9,
    carbs: 16,
    fat: 0.4,
  },
];

const originalFetch = globalThis.fetch;

function mockFetch(data: unknown, ok = true) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(data), {
        status: ok ? 200 : 500,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("lib/ciqual — searchCiqual", () => {
  beforeEach(() => {
    __resetCiqualCacheForTests();
    mockFetch(DATA);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns [] for an empty query without fetching", async () => {
    const r = await searchCiqual("  ", 5);
    expect(r).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("name-matches and tags source: ciqual", async () => {
    const r = await searchCiqual("lentil", 5);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Lentil, cooked", source: "ciqual" });
  });

  it("orders prefix matches before substring matches", async () => {
    const r = await searchCiqual("milk", 5);
    expect(r.map((f) => f.name)).toEqual([
      "Milk, whole", // prefix
      "Milk chocolate", // prefix
      "Buttermilk", // substring
    ]);
  });

  it("respects the limit (prefix-first)", async () => {
    const r = await searchCiqual("milk", 1);
    expect(r.map((f) => f.name)).toEqual(["Milk, whole"]);
  });

  it("fetches once and caches across searches", async () => {
    await searchCiqual("milk", 5);
    await searchCiqual("lentil", 5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("degrades to [] when the asset can't be fetched", async () => {
    __resetCiqualCacheForTests();
    mockFetch([], false);
    const r = await searchCiqual("milk", 5);
    expect(r).toEqual([]);
  });
});
