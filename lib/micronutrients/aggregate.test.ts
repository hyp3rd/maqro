import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  aggregateBreakdownWithProfiles,
  aggregateMicronutrients,
  aggregateMicronutrientsDetailed,
  averageMicronutrientsDetailed,
  computeMicronutrientWindow,
  foodNameKey,
  resolveMealFiber,
} from "./aggregate";
import type { MicronutrientProfile } from "./types";

function food(name: string, portionSize: number): FoodItem {
  return {
    id: Math.floor(Math.random() * 1e6),
    name,
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    portionSize,
  };
}

function meal(foods: FoodItem[]): Meal {
  return { id: 1, name: "Meal", foods };
}

function profile(
  name: string,
  valuesPer100g: MicronutrientProfile["valuesPer100g"],
): MicronutrientProfile {
  return {
    nameKey: foodNameKey(name),
    source: "search",
    valuesPer100g,
    enrichedAt: 0,
  };
}

function profileMap(
  rows: MicronutrientProfile[],
): Map<string, MicronutrientProfile> {
  return new Map(rows.map((p) => [p.nameKey, p]));
}

function dayLog(date: string, foods: FoodItem[]): DailyLog {
  return { date, meals: [meal(foods)], updatedAt: 0 };
}

describe("aggregateMicronutrients", () => {
  it("scales per-100g profile values by portion grams", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 200)])], // 2× the per-100g
      profileMap([profile("Spinach", { iron: 2.7, calcium: 99 })]),
    );
    expect(out.iron).toBeCloseTo(5.4);
    expect(out.calcium).toBeCloseTo(198);
  });

  it("sums the same nutrient across multiple foods", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 100), food("Lentils", 100)])],
      profileMap([
        profile("Spinach", { iron: 2.7 }),
        profile("Lentils", { iron: 3.3 }),
      ]),
    );
    expect(out.iron).toBeCloseTo(6);
  });

  it("joins by normalized name (case / whitespace insensitive)", () => {
    const out = aggregateMicronutrients(
      [meal([food("  SPINACH ", 100)])],
      profileMap([profile("spinach", { iron: 2.7 })]),
    );
    expect(out.iron).toBeCloseTo(2.7);
  });

  it("omits nutrients no contributing food carries (no misleading zero)", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 100)])],
      profileMap([profile("Spinach", { iron: 2.7 })]),
    );
    expect(out.iron).toBeCloseTo(2.7);
    expect(out.zinc).toBeUndefined();
    expect("zinc" in out).toBe(false);
  });

  it("contributes nothing for a food with no profile", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 100), food("Mystery Food", 100)])],
      profileMap([profile("Spinach", { iron: 2.7 })]),
    );
    expect(out.iron).toBeCloseTo(2.7);
  });

  it("returns an empty object when nothing is enriched", () => {
    const out = aggregateMicronutrients(
      [meal([food("Mystery", 100)])],
      profileMap([]),
    );
    expect(out).toEqual({});
  });

  it("skips foods with a non-positive portion", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 0)])],
      profileMap([profile("Spinach", { iron: 2.7 })]),
    );
    expect(out).toEqual({});
  });

  it("prefers the food's own captured micronutrients over the name cache", () => {
    const f = food("Spinach", 100);
    f.micronutrients = { iron: 5 }; // exact per-100g from the logged product
    const out = aggregateMicronutrients(
      [meal([f])],
      profileMap([profile("Spinach", { iron: 2.7 })]), // approximate cache
    );
    // The per-food value wins; the cache is the fallback only.
    expect(out.iron).toBeCloseTo(5);
  });

  it("falls back to the name cache when the food has no captured micros", () => {
    const out = aggregateMicronutrients(
      [meal([food("Spinach", 100)])], // no food.micronutrients
      profileMap([profile("Spinach", { iron: 2.7 })]),
    );
    expect(out.iron).toBeCloseTo(2.7);
  });

  it("scales the food's own micronutrients by portion", () => {
    const f = food("Spinach", 250); // 2.5×
    f.micronutrients = { iron: 4 };
    const out = aggregateMicronutrients([meal([f])], profileMap([]));
    expect(out.iron).toBeCloseTo(10);
  });

  it("merges per NUTRIENT: the profile fills fields a partial product lacks", () => {
    // OFF rows routinely carry a couple of values (here: sodium only).
    // The profile's fiber/iron must still count — per-food fallback used
    // to discard them the moment the product carried anything at all.
    const f = food("Psyllium", 10);
    f.micronutrients = { sodium: 50 };
    const out = aggregateMicronutrients(
      [meal([f])],
      profileMap([profile("Psyllium", { fiber: 85, iron: 9, sodium: 999 })]),
    );
    expect(out.sodium).toBeCloseTo(5); // product value wins where present
    expect(out.fiber).toBeCloseTo(8.5); // profile fills the gap
    expect(out.iron).toBeCloseTo(0.9);
  });

  it("falls back to the macro-side scaled fiber when no per-100g source has it", () => {
    const f = food("Bran cereal", 50);
    f.fiber = 7.5; // MacroBreakdown fiber, already scaled to the 50 g portion
    const out = aggregateMicronutrients([meal([f])], profileMap([]));
    expect(out.fiber).toBeCloseTo(7.5); // added as-is, not re-scaled
  });

  it("prefers per-100g fiber sources over the macro-side value", () => {
    const f = food("Bran cereal", 50);
    f.fiber = 99; // stale/damaged macro-side value
    f.micronutrients = { fiber: 30 };
    const out = aggregateMicronutrients([meal([f])], profileMap([]));
    expect(out.fiber).toBeCloseTo(15); // 30 per-100g × 0.5
  });
});

describe("aggregateBreakdownWithProfiles", () => {
  it("prefers the food's own scaled sub-macros (exact product data)", () => {
    const f = food("Yogurt", 200);
    f.sugars = 8; // already scaled to the 200 g portion
    const out = aggregateBreakdownWithProfiles(
      [meal([f])],
      profileMap([
        { ...profile("Yogurt", {}), breakdownPer100g: { sugars: 99 } },
      ]),
    );
    expect(out.sugars).toBeCloseTo(8);
  });

  it("falls back to the profile's per-100g breakdown × portion", () => {
    const f = food("Mystery bar", 50); // no top-level sub-macros
    const out = aggregateBreakdownWithProfiles(
      [meal([f])],
      profileMap([
        {
          ...profile("Mystery bar", {}),
          breakdownPer100g: { sugars: 30, saturatedFat: 10 },
        },
      ]),
    );
    expect(out.sugars).toBeCloseTo(15); // 30 × 0.5
    expect(out.saturatedFat).toBeCloseTo(5);
  });

  it("resolves fiber through the micros chain, same as resolveMealFiber", () => {
    const f = food("Psyllium", 10);
    f.fiber = 99; // stale macro-side value loses to per-100g micros
    f.micronutrients = { fiber: 85 };
    const out = aggregateBreakdownWithProfiles([meal([f])], profileMap([]));
    expect(out.fiber).toBeCloseTo(8.5);
  });

  it("omits keys no food contributed (absent ≠ zero)", () => {
    const out = aggregateBreakdownWithProfiles(
      [meal([food("Plain", 100)])],
      profileMap([]),
    );
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe("aggregateMicronutrientsDetailed (provenance)", () => {
  function withSource(
    p: MicronutrientProfile,
    source: MicronutrientProfile["source"],
  ): MicronutrientProfile {
    return { ...p, source };
  }

  it("own micros are EXACT only when the food carries an offCode", () => {
    const exact: FoodItem = {
      ...food("Nutella", 100),
      offCode: "3017620422003",
      micronutrients: { iron: 2 },
    };
    const approx: FoodItem = {
      ...food("Generic spread", 100),
      micronutrients: { iron: 2 }, // own micros but NO barcode
    };
    expect(
      aggregateMicronutrientsDetailed([meal([exact])], profileMap([])).approx
        .iron,
    ).toBeUndefined();
    expect(
      aggregateMicronutrientsDetailed([meal([approx])], profileMap([])).approx
        .iron,
    ).toBe(true);
  });

  it("treats a blank/whitespace offCode as NOT exact (never a false 'exact')", () => {
    const blank: FoodItem = {
      ...food("Suspect", 100),
      offCode: "   ",
      micronutrients: { iron: 2 },
    };
    expect(
      aggregateMicronutrientsDetailed([meal([blank])], profileMap([])).approx
        .iron,
    ).toBe(true);
  });

  it("profile values are exact for barcode/ciqual, approximate for search/ai", () => {
    const f = food("Spinach", 100);
    const detail = (src: MicronutrientProfile["source"]) =>
      aggregateMicronutrientsDetailed(
        [meal([f])],
        profileMap([withSource(profile("Spinach", { iron: 3 }), src)]),
      ).approx.iron;
    expect(detail("barcode")).toBeUndefined();
    expect(detail("ciqual")).toBeUndefined();
    expect(detail("search")).toBe(true);
    expect(detail("ai")).toBe(true);
  });

  it("macro-side fiber fallback is always approximate", () => {
    const f = food("Bran", 50);
    f.fiber = 7.5; // only the macro-side value
    const { totals, approx } = aggregateMicronutrientsDetailed(
      [meal([f])],
      profileMap([]),
    );
    expect(totals.fiber).toBeCloseTo(7.5);
    expect(approx.fiber).toBe(true);
  });

  it("worst-case: one approximate contributor flips the whole nutrient", () => {
    const exact: FoodItem = {
      ...food("Branded oats", 100),
      offCode: "1234567890123",
      micronutrients: { iron: 4 },
    };
    const approx: FoodItem = {
      ...food("Loose oats", 100),
      micronutrients: { iron: 4 }, // no barcode
    };
    const out = aggregateMicronutrientsDetailed(
      [meal([exact, approx])],
      profileMap([]),
    );
    expect(out.totals.iron).toBeCloseTo(8);
    expect(out.approx.iron).toBe(true); // mixed → approximate
  });

  it("all-exact contributors leave the nutrient unflagged", () => {
    const a: FoodItem = {
      ...food("A", 100),
      offCode: "1111111111111",
      micronutrients: { iron: 2 },
    };
    const b: FoodItem = {
      ...food("B", 100),
      offCode: "2222222222222",
      micronutrients: { iron: 3 },
    };
    const out = aggregateMicronutrientsDetailed([meal([a, b])], profileMap([]));
    expect(out.totals.iron).toBeCloseTo(5);
    expect(out.approx.iron).toBeUndefined();
  });
});

describe("averageMicronutrientsDetailed", () => {
  it("reports per-nutrient day coverage alongside the averages", () => {
    const out = averageMicronutrientsDetailed([
      { date: "2026-06-01", totals: { iron: 4, fiber: 10 }, approx: {} },
      { date: "2026-06-02", totals: { iron: 6 }, approx: {} },
      { date: "2026-06-03", totals: { iron: 8 }, approx: {} },
    ]);
    expect(out.dayCount).toBe(3);
    expect(out.totals.iron).toBeCloseTo(6);
    expect(out.daysWith.iron).toBe(3);
    // Fiber appeared once — the mean spans that one day, and the
    // coverage count makes that visible to the UI.
    expect(out.totals.fiber).toBeCloseTo(10);
    expect(out.daysWith.fiber).toBe(1);
  });

  it("flags a nutrient approximate if ANY contributing day was approximate", () => {
    const out = averageMicronutrientsDetailed([
      {
        date: "2026-06-01",
        totals: { iron: 4, zinc: 5 },
        approx: { iron: true },
      },
      { date: "2026-06-02", totals: { iron: 6, zinc: 5 }, approx: {} },
    ]);
    // iron was approximate on day 1 → the window average is approximate.
    expect(out.approx.iron).toBe(true);
    // zinc was exact on every day it appeared → no marker.
    expect(out.approx.zinc).toBeUndefined();
  });
});

describe("resolveMealFiber", () => {
  it("resolves per food with the same chain as the aggregator", () => {
    const fromMicros = food("Psyllium", 10);
    fromMicros.micronutrients = { fiber: 85 };
    const fromProfile = food("Apple", 120);
    const fromMacro = food("Bran cereal", 50);
    fromMacro.fiber = 7.5;
    const { grams } = resolveMealFiber(
      meal([fromMicros, fromProfile, fromMacro]),
      profileMap([profile("Apple", { fiber: 2.4 })]),
    );
    // 8.5 (micros) + 2.88 (profile) + 7.5 (macro-side) = 18.88 → 18.9
    expect(grams).toBeCloseTo(18.9);
  });

  it("returns undefined grams when no food has any fiber source", () => {
    const { grams, knownCalorieShare } = resolveMealFiber(
      meal([food("Mystery", 100)]),
      profileMap([]),
    );
    expect(grams).toBeUndefined();
    expect(knownCalorieShare).toBe(0);
  });

  it("reports the calorie share of fiber-known foods", () => {
    const known = food("Apple", 100);
    known.fiber = 2.4;
    known.calories = 60;
    const unknown = food("Mystery shake", 100);
    unknown.calories = 240;
    const { grams, knownCalorieShare } = resolveMealFiber(
      meal([known, unknown]),
      profileMap([]),
    );
    expect(grams).toBeCloseTo(2.4);
    expect(knownCalorieShare).toBeCloseTo(0.2); // 60 of 300 kcal known
  });
});

describe("computeMicronutrientWindow", () => {
  const profiles = profileMap([profile("Spinach", { iron: 2.7 })]);

  it("returns one entry per logged day, sorted ascending", () => {
    const logs = [
      dayLog("2026-05-17", [food("Spinach", 100)]),
      dayLog("2026-05-15", [food("Spinach", 200)]),
      dayLog("2026-05-16", [food("Spinach", 100)]),
    ];
    const out = computeMicronutrientWindow(logs, profiles, "2026-05-20", 30);
    expect(out.map((d) => d.date)).toEqual([
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
    ]);
    expect(out[0]?.totals.iron).toBeCloseTo(5.4);
  });

  it("excludes future-dated meal-plan entries", () => {
    const logs = [
      dayLog("2026-05-15", [food("Spinach", 100)]),
      dayLog("2026-05-25", [food("Spinach", 100)]), // future
    ];
    const out = computeMicronutrientWindow(logs, profiles, "2026-05-20", 30);
    expect(out.map((d) => d.date)).toEqual(["2026-05-15"]);
  });

  it("skips days with no enriched food (no gap padding)", () => {
    const logs = [
      dayLog("2026-05-15", [food("Spinach", 100)]),
      dayLog("2026-05-16", [food("Mystery", 100)]), // no profile → skipped
    ];
    const out = computeMicronutrientWindow(logs, profiles, "2026-05-20", 30);
    expect(out.map((d) => d.date)).toEqual(["2026-05-15"]);
  });

  it("clamps to the last N days", () => {
    const logs = Array.from({ length: 10 }, (_, i) =>
      dayLog(`2026-05-0${i + 1}`.replace(/0(\d\d)$/, "$1"), [
        food("Spinach", 100),
      ]),
    );
    const out = computeMicronutrientWindow(logs, profiles, "2026-05-31", 3);
    expect(out).toHaveLength(3);
  });
});
