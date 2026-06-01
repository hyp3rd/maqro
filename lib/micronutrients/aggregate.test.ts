import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  aggregateMicronutrients,
  computeMicronutrientWindow,
  foodNameKey,
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
