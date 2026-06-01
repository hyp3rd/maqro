import { describe, expect, it } from "vitest";
import {
  getDemoMealLogs,
  getDemoProfile,
  getDemoWeightHistory,
} from "./demo-data";

const TODAY = "2026-05-20";
const NOW = new Date("2026-05-20T12:00:00Z").getTime();

describe("getDemoProfile", () => {
  it("returns a valid PersonalInfo with realistic numbers", () => {
    const p = getDemoProfile();
    expect(p.gender).toBe("female");
    expect(p.age).toBeGreaterThan(18);
    expect(p.age).toBeLessThan(80);
    expect(p.weight).toBeGreaterThan(40);
    expect(p.weight).toBeLessThan(200);
    expect(p.height).toBeGreaterThan(120);
    expect(p.height).toBeLessThan(220);
    // Required-by-type fields are present.
    expect(p.dietPreference).toBeDefined();
    expect(p.dietType).toBeDefined();
    expect(p.goal).toBeDefined();
    expect(p.activityLevel).toBeDefined();
  });

  it("uses a fixed display name so the sidebar shows something obvious", () => {
    expect(getDemoProfile().displayName).toBe("Sample");
  });
});

describe("getDemoMealLogs", () => {
  it("produces exactly 7 days of logs ending on `today`", () => {
    const logs = getDemoMealLogs(TODAY, NOW);
    expect(logs).toHaveLength(7);
    expect(logs[logs.length - 1].date).toBe(TODAY);
  });

  it("dates are sorted oldest → newest", () => {
    const logs = getDemoMealLogs(TODAY, NOW);
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].date > logs[i - 1].date).toBe(true);
    }
  });

  it("every log has four meals (Breakfast / Lunch / Dinner / Snacks)", () => {
    const logs = getDemoMealLogs(TODAY, NOW);
    for (const log of logs) {
      expect(log.meals).toHaveLength(4);
      const names = log.meals.map((m) => m.name);
      expect(names).toEqual(["Breakfast", "Lunch", "Dinner", "Snacks"]);
    }
  });

  it("food items have macro values broadly consistent with 4P + 4C + 9F", () => {
    // Sanity-check that no demo food has wildly wrong calories
    // vs its protein/carbs/fat breakdown. The tolerance is wide
    // because real catalog entries don't follow strict Atwater:
    // fiber and sugar alcohols affect calorie yield, especially
    // for low-calorie vegetables (broccoli at 34 kcal/100g vs
    // 4P+4C+9F = 42.8 — ~25% off).
    //
    // We're catching order-of-magnitude bugs, not minor rounding.
    // Below 60 kcal/portion we skip entirely (too much relative
    // noise); above we allow 30%.
    const logs = getDemoMealLogs(TODAY, NOW);
    for (const log of logs) {
      for (const meal of log.meals) {
        for (const food of meal.foods) {
          if (food.calories < 60) continue;
          const expected = food.protein * 4 + food.carbs * 4 + food.fat * 9;
          const tolerance = food.calories * 0.3;
          expect(
            Math.abs(food.calories - expected),
            `${food.name}: ${food.calories} kcal vs expected ${expected.toFixed(1)}`,
          ).toBeLessThanOrEqual(tolerance);
        }
      }
    }
  });

  it("food items have unique ids within a day's meals", () => {
    const logs = getDemoMealLogs(TODAY, NOW);
    for (const log of logs) {
      const ids = log.meals.flatMap((m) => m.foods.map((f) => f.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("updatedAt timestamps decrease with each older day", () => {
    const logs = getDemoMealLogs(TODAY, NOW);
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].updatedAt).toBeGreaterThan(logs[i - 1].updatedAt);
    }
  });
});

describe("getDemoWeightHistory", () => {
  it("produces 14 entries ending on `today`", () => {
    const w = getDemoWeightHistory(TODAY, NOW);
    expect(w).toHaveLength(14);
    expect(w[w.length - 1].date).toBe(TODAY);
  });

  it("shows a downward trend (start > end) but with realistic noise", () => {
    const w = getDemoWeightHistory(TODAY, NOW);
    const start = w[0].kg;
    const end = w[w.length - 1].kg;
    // Start should be heavier than end (we're "losing weight").
    expect(start).toBeGreaterThan(end);
    // The change should be small — 0.4 kg/week × 2 weeks = 0.8
    // kg, plus noise. Allow 0.2-2.0 kg total decrease.
    expect(start - end).toBeGreaterThan(0.2);
    expect(start - end).toBeLessThan(2);
  });

  it("weights stay within a believable adult-female range", () => {
    const w = getDemoWeightHistory(TODAY, NOW);
    for (const entry of w) {
      expect(entry.kg).toBeGreaterThan(50);
      expect(entry.kg).toBeLessThan(100);
    }
  });

  it("dates are sorted oldest → newest", () => {
    const w = getDemoWeightHistory(TODAY, NOW);
    for (let i = 1; i < w.length; i++) {
      expect(w[i].date > w[i - 1].date).toBe(true);
    }
  });
});
