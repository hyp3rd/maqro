import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchOpenFoodFactsServer } from "./off-search";

// The helper hits upstream OFF directly via `fetch`. We mock global fetch
// so these tests stay offline and deterministic.
const originalFetch = globalThis.fetch;

function mockFetch(
  response: { hits?: unknown[] } | { error: string },
  ok = true,
) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response), {
        status: ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("searchOpenFoodFactsServer", () => {
  beforeEach(() => {
    // Reset between specs so a leak from one doesn't poison the next.
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns [] for an empty query without hitting upstream", async () => {
    const result = await searchOpenFoodFactsServer("   ", 5);
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("normalizes hits with all macros into Food shape", async () => {
    mockFetch({
      hits: [
        {
          code: "123",
          product_name: "Greek Yogurt",
          brands: "Fage",
          nutriments: {
            proteins_100g: 10,
            carbohydrates_100g: 3.6,
            fat_100g: 0.4,
            "energy-kcal_100g": 59,
          },
        },
      ],
    });

    const result = await searchOpenFoodFactsServer("yogurt", 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "off:123",
      source: "off",
      name: "Greek Yogurt",
      protein: 10,
      carbs: 3.6,
      fat: 0.4,
      calories: 59,
      brand: "Fage",
    });
  });

  it("drops hits missing all macros (would surface as NaNs)", async () => {
    mockFetch({
      hits: [
        { code: "456", product_name: "Mystery Product", nutriments: {} },
        {
          code: "789",
          product_name: "Real Product",
          nutriments: { proteins_100g: 20 },
        },
      ],
    });

    const result = await searchOpenFoodFactsServer("mystery", 5);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Real Product");
  });

  it("falls back to energy-kcal alias when energy-kcal_100g is absent", async () => {
    mockFetch({
      hits: [
        {
          code: "alias",
          product_name: "Oats",
          nutriments: {
            proteins_100g: 13,
            carbohydrates_100g: 67,
            fat_100g: 7,
            "energy-kcal": 389, // alias path
          },
        },
      ],
    });

    const result = await searchOpenFoodFactsServer("oats", 5);
    expect(result[0].calories).toBe(389);
  });

  it("derives calories from 4/4/9 when neither energy field is present", async () => {
    mockFetch({
      hits: [
        {
          code: "noeng",
          product_name: "No Energy",
          nutriments: {
            proteins_100g: 10, // 40 kcal
            carbohydrates_100g: 20, // 80 kcal
            fat_100g: 5, // 45 kcal
          },
        },
      ],
    });

    const result = await searchOpenFoodFactsServer("anything", 5);
    expect(result[0].calories).toBe(165); // 40 + 80 + 45
  });

  it("extracts the first brand from an array", async () => {
    mockFetch({
      hits: [
        {
          code: "arr",
          product_name: "X",
          brands: ["Brand A", "Brand B"],
          nutriments: { proteins_100g: 1 },
        },
      ],
    });
    const result = await searchOpenFoodFactsServer("x", 5);
    expect(result[0].brand).toBe("Brand A");
  });

  it("extracts the first brand from a comma-separated string", async () => {
    mockFetch({
      hits: [
        {
          code: "str",
          product_name: "Y",
          brands: "Brand X, Brand Y, Brand Z",
          nutriments: { proteins_100g: 1 },
        },
      ],
    });
    const result = await searchOpenFoodFactsServer("y", 5);
    expect(result[0].brand).toBe("Brand X");
  });

  it("returns an empty array when upstream returns no hits field", async () => {
    mockFetch({});
    const result = await searchOpenFoodFactsServer("nope", 5);
    expect(result).toEqual([]);
  });

  it("throws a descriptive error when upstream returns non-2xx", async () => {
    mockFetch({ error: "internal" }, false);
    await expect(searchOpenFoodFactsServer("anything", 5)).rejects.toThrow(
      /Open Food Facts search failed/,
    );
  });

  it("clamps limit below 1 to 1 in the upstream page_size param", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    await searchOpenFoodFactsServer("x", 0);
    await searchOpenFoodFactsServer("x", -3);
    await searchOpenFoodFactsServer("x", 99); // clamped down to MAX_LIMIT=10

    const calls = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    const pageSizes = calls.map((c) => {
      const url = new URL(String(c[0]));
      return url.searchParams.get("page_size");
    });
    expect(pageSizes).toEqual(["1", "1", "10"]);
  });

  it("times out after 5s when upstream hangs", async () => {
    vi.useFakeTimers();
    try {
      // Mock fetch that never resolves on its own — it only rejects when
      // the caller's AbortSignal fires, which is what we're testing.
      globalThis.fetch = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            });
          }),
      ) as unknown as typeof fetch;

      const pending = searchOpenFoodFactsServer("hangs", 5);
      // Surface unhandled rejections so the assertion can observe them.
      pending.catch(() => {});

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pending).rejects.toThrow(/timed out after 5s/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hitToFood — Open Food Facts → Food (sub-macros)", () => {
  it("extracts the optional macro-breakdown when OFF supplies it", async () => {
    const { hitToFood } = await import("./off-search");
    const food = hitToFood({
      code: "12345",
      product_name: "Test cereal",
      brands: "Test Co",
      nutriments: {
        proteins_100g: 8,
        carbohydrates_100g: 70,
        fat_100g: 5,
        "energy-kcal_100g": 380,
        sugars_100g: 22,
        "sugars-added_100g": 18,
        fiber_100g: 6,
        "saturated-fat_100g": 1.5,
        "trans-fat_100g": 0,
        "monounsaturated-fat_100g": 2,
        "polyunsaturated-fat_100g": 1,
      },
    });
    expect(food).not.toBeNull();
    if (!food) return;
    expect(food.sugars).toBe(22);
    expect(food.addedSugars).toBe(18);
    expect(food.fiber).toBe(6);
    expect(food.saturatedFat).toBe(1.5);
    expect(food.transFat).toBe(0);
    expect(food.monoFat).toBe(2);
    expect(food.polyFat).toBe(1);
  });

  it("leaves sub-macros undefined when OFF doesn't supply them (so display can hide rather than show '0g')", async () => {
    const { hitToFood } = await import("./off-search");
    const food = hitToFood({
      code: "67890",
      product_name: "Plain rice",
      nutriments: {
        proteins_100g: 7,
        carbohydrates_100g: 80,
        fat_100g: 1,
        "energy-kcal_100g": 360,
      },
    });
    expect(food).not.toBeNull();
    if (!food) return;
    expect(food.sugars).toBeUndefined();
    expect(food.fiber).toBeUndefined();
    expect(food.saturatedFat).toBeUndefined();
  });

  it("treats non-numeric values defensively (NaN / string → undefined)", async () => {
    const { hitToFood } = await import("./off-search");
    const food = hitToFood({
      code: "99999",
      product_name: "Bogus row",
      nutriments: {
        proteins_100g: 5,
        carbohydrates_100g: 10,
        fat_100g: 2,
        "energy-kcal_100g": 80,
        sugars_100g: "12" as unknown as number,
        fiber_100g: NaN,
      },
    });
    expect(food).not.toBeNull();
    if (!food) return;
    expect(food.sugars).toBeUndefined();
    expect(food.fiber).toBeUndefined();
  });
});

describe("offHitToMicronutrients — OFF → canonical-unit micronutrients", () => {
  it("converts base-SI grams to each nutrient's canonical unit", async () => {
    const { offHitToMicronutrients } = await import("./off-search");
    const micros = offHitToMicronutrients({
      code: "m1",
      product_name: "Fortified cereal",
      nutriments: {
        fiber_100g: 6, // g → g (×1)
        sodium_100g: 0.5, // g → 500 mg (×1000)
        potassium_100g: 0.3, // g → 300 mg
        calcium_100g: 0.12, // g → 120 mg
        iron_100g: 0.008, // g → 8 mg
        magnesium_100g: 0.05, // g → 50 mg
        zinc_100g: 0.003, // g → 3 mg
        "vitamin-c_100g": 0.06, // g → 60 mg
        "vitamin-d_100g": 0.00001, // g → 10 µg (×1e6)
        "vitamin-b12_100g": 0.0000024, // g → 2.4 µg
      },
    });
    expect(micros.fiber).toBeCloseTo(6);
    expect(micros.sodium).toBeCloseTo(500);
    expect(micros.potassium).toBeCloseTo(300);
    expect(micros.calcium).toBeCloseTo(120);
    expect(micros.iron).toBeCloseTo(8);
    expect(micros.magnesium).toBeCloseTo(50);
    expect(micros.zinc).toBeCloseTo(3);
    expect(micros.vitaminC).toBeCloseTo(60);
    expect(micros.vitaminD).toBeCloseTo(10);
    expect(micros.vitaminB12).toBeCloseTo(2.4);
  });

  it("omits nutrients the product doesn't carry (no misleading zeros)", async () => {
    const { offHitToMicronutrients } = await import("./off-search");
    const micros = offHitToMicronutrients({
      code: "m2",
      product_name: "Plain water",
      nutriments: { sodium_100g: 0.01 },
    });
    expect(micros.sodium).toBeCloseTo(10);
    expect(Object.keys(micros)).toEqual(["sodium"]);
    expect(micros.iron).toBeUndefined();
  });

  it("drops non-finite values defensively", async () => {
    const { offHitToMicronutrients } = await import("./off-search");
    const micros = offHitToMicronutrients({
      code: "m3",
      product_name: "Bogus",
      nutriments: {
        iron_100g: NaN,
        zinc_100g: "0.003" as unknown as number,
        calcium_100g: 0.1,
      },
    });
    expect(micros.iron).toBeUndefined();
    expect(micros.zinc).toBeUndefined();
    expect(micros.calcium).toBeCloseTo(100);
  });

  it("returns an empty object when no nutriments are present", async () => {
    const { offHitToMicronutrients } = await import("./off-search");
    expect(offHitToMicronutrients({ product_name: "x" })).toEqual({});
  });
});

describe("hitToFood — micronutrient capture", () => {
  it("attaches per-100g micronutrients when OFF supplies them", async () => {
    const { hitToFood } = await import("./off-search");
    const food = hitToFood({
      code: "mc1",
      product_name: "Fortified milk",
      nutriments: {
        proteins_100g: 3,
        carbohydrates_100g: 5,
        fat_100g: 1,
        "energy-kcal_100g": 42,
        calcium_100g: 0.12, // → 120 mg
        "vitamin-d_100g": 0.000001, // → 1 µg
      },
    });
    expect(food?.micronutrients?.calcium).toBeCloseTo(120);
    expect(food?.micronutrients?.vitaminD).toBeCloseTo(1);
  });

  it("omits the micronutrients field entirely when OFF has none", async () => {
    const { hitToFood } = await import("./off-search");
    const food = hitToFood({
      code: "mc2",
      product_name: "Plain sugar",
      nutriments: {
        proteins_100g: 0,
        carbohydrates_100g: 100,
        fat_100g: 0,
        "energy-kcal_100g": 400,
      },
    });
    expect(food).not.toBeNull();
    expect(food?.micronutrients).toBeUndefined();
  });
});

describe("medianMicronutrients", () => {
  it("returns the median per nutrient across hits (odd count)", async () => {
    const { medianMicronutrients } = await import("./off-search");
    const out = medianMicronutrients([
      { product_name: "a", nutriments: { iron_100g: 0.001 } }, // 1 mg
      { product_name: "b", nutriments: { iron_100g: 0.003 } }, // 3 mg
      { product_name: "c", nutriments: { iron_100g: 0.009 } }, // 9 mg → median 3
    ]);
    expect(out.iron).toBeCloseTo(3);
  });

  it("averages the two middle values for an even count", async () => {
    const { medianMicronutrients } = await import("./off-search");
    const out = medianMicronutrients([
      { product_name: "a", nutriments: { zinc_100g: 0.002 } }, // 2 mg
      { product_name: "b", nutriments: { zinc_100g: 0.004 } }, // 4 mg → median 3
    ]);
    expect(out.zinc).toBeCloseTo(3);
  });

  it("ignores hits missing a given nutrient (no zero-padding)", async () => {
    const { medianMicronutrients } = await import("./off-search");
    const out = medianMicronutrients([
      { product_name: "a", nutriments: { iron_100g: 0.002 } }, // 2 mg
      { product_name: "b", nutriments: { calcium_100g: 0.1 } }, // no iron
      { product_name: "c", nutriments: { iron_100g: 0.004 } }, // 4 mg → iron median 3
    ]);
    expect(out.iron).toBeCloseTo(3); // median of [2,4], not [2,0,4]
    expect(out.calcium).toBeCloseTo(100);
  });

  it("returns an empty object for no hits", async () => {
    const { medianMicronutrients } = await import("./off-search");
    expect(medianMicronutrients([])).toEqual({});
  });
});

describe("MICRONUTRIENTS reference table", () => {
  it("every key has a positive DV, a unit, and a conversion factor", async () => {
    const { MICRONUTRIENTS, MICRONUTRIENT_KEYS } = await import("@/lib/rda");
    expect(MICRONUTRIENT_KEYS).toHaveLength(10);
    for (const key of MICRONUTRIENT_KEYS) {
      const meta = MICRONUTRIENTS[key];
      expect(meta.dv).toBeGreaterThan(0);
      expect(["g", "mg", "µg"]).toContain(meta.unit);
      expect([1, 1000, 1_000_000]).toContain(meta.offGramsToCanonical);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.cssVar.startsWith("--micro-")).toBe(true);
    }
  });
});

describe("getMicronutrientTargets", () => {
  it("falls back to FDA Daily Values for unspecified sex", async () => {
    const { getMicronutrientTargets, MICRONUTRIENTS } =
      await import("@/lib/rda");
    const t = getMicronutrientTargets("unspecified", 30);
    expect(t.iron).toBe(MICRONUTRIENTS.iron.dv); // 18
    expect(t.calcium).toBe(MICRONUTRIENTS.calcium.dv); // 1300
  });

  it("uses sex-specific NIH RDA for adult men vs women", async () => {
    const { getMicronutrientTargets } = await import("@/lib/rda");
    const men = getMicronutrientTargets("male", 30);
    const women = getMicronutrientTargets("female", 30);
    // The headline sex differences.
    expect(men.iron).toBe(8);
    expect(women.iron).toBe(18);
    expect(men.zinc).toBe(11);
    expect(women.zinc).toBe(8);
    expect(men.magnesium).toBe(420);
    expect(women.magnesium).toBe(320);
  });

  it("applies the 51+ overlay: post-menopausal iron drops, calcium rises", async () => {
    const { getMicronutrientTargets } = await import("@/lib/rda");
    const olderWoman = getMicronutrientTargets("female", 55);
    expect(olderWoman.iron).toBe(8); // down from 18
    expect(olderWoman.calcium).toBe(1200); // up from 1000
    expect(olderWoman.fiber).toBe(21);
  });

  it("raises vitamin D at 71+ for both sexes", async () => {
    const { getMicronutrientTargets } = await import("@/lib/rda");
    expect(getMicronutrientTargets("male", 75).vitaminD).toBe(20);
    expect(getMicronutrientTargets("female", 75).vitaminD).toBe(20);
    expect(getMicronutrientTargets("male", 40).vitaminD).toBe(15);
  });
});
