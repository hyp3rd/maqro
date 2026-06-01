import type { WeightEntry } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { detectPlateau, recalibrateTdee, smoothWeights } from "./trends";

function weighIn(date: string, kg: number): WeightEntry {
  return {
    date,
    kg,
    recordedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

describe("smoothWeights", () => {
  it("returns null smoothed for the first window-1 points", () => {
    const out = smoothWeights(
      [
        weighIn("2026-05-01", 80),
        weighIn("2026-05-02", 79),
        weighIn("2026-05-03", 78),
      ],
      7,
    );
    expect(out[0].smoothed).toBeNull();
    expect(out[1].smoothed).toBeNull();
    expect(out[2].smoothed).toBeNull();
  });

  it("computes a trailing simple mean once the window fills", () => {
    const out = smoothWeights(
      Array.from({ length: 8 }, (_, i) =>
        weighIn(`2026-05-${(i + 1).toString().padStart(2, "0")}`, 80 - i * 0.1),
      ),
      7,
    );
    // First 6 are null; index 6 (the 7th point) has full window.
    expect(out[5].smoothed).toBeNull();
    expect(out[6].smoothed).not.toBeNull();
    // Mean of 80, 79.9, 79.8, 79.7, 79.6, 79.5, 79.4 = 79.7
    expect(out[6].smoothed!).toBeCloseTo(79.7, 5);
    // Index 7 drops 80, adds 79.3: mean shifts to 79.6.
    expect(out[7].smoothed!).toBeCloseTo(79.6, 5);
  });

  it("rejects non-positive smoothing windows", () => {
    expect(() => smoothWeights([], 0)).toThrow();
    expect(() => smoothWeights([], -1)).toThrow();
  });

  it("preserves raw kg + date pairings (independent of smoothing)", () => {
    const out = smoothWeights([weighIn("2026-05-01", 80)], 7);
    expect(out[0]).toMatchObject({ date: "2026-05-01", kg: 80 });
  });
});

describe("detectPlateau", () => {
  it("returns no-plateau no-advisory when there's no data", () => {
    const r = detectPlateau([], "lose");
    expect(r.plateaued).toBe(false);
    expect(r.advisory).toBeNull();
  });

  it("returns no-plateau when fewer than 2 smoothed points exist", () => {
    // Only 5 points — none of them get a smoothed value (window=7).
    const weights = Array.from({ length: 5 }, (_, i) =>
      weighIn(`2026-05-${(i + 1).toString().padStart(2, "0")}`, 80),
    );
    const r = detectPlateau(weights, "lose");
    expect(r.plateaued).toBe(false);
    expect(r.advisory).toBeNull();
  });

  it("flags a plateau when smoothed weight has been flat for ≥ windowDays", () => {
    // 30 entries, all 80.0 — smoothed is 80.0 from day 7 onwards.
    const weights = Array.from({ length: 30 }, (_, i) =>
      weighIn(`2026-05-${(i + 1).toString().padStart(2, "0")}`, 80),
    );
    const r = detectPlateau(weights, "lose", 14, 0.5);
    expect(r.plateaued).toBe(true);
    expect(r.daysFlat).toBeGreaterThanOrEqual(14);
    expect(r.advisory).toMatch(/flat/);
  });

  it("does NOT flag a plateau when weight is moving outside tolerance", () => {
    // Steady 0.1 kg/day loss → over 20 days the smoothed weight
    // changes by ~2 kg, well outside the 0.5 kg tolerance.
    const weights = Array.from({ length: 25 }, (_, i) =>
      weighIn(`2026-05-${(i + 1).toString().padStart(2, "0")}`, 80 - i * 0.1),
    );
    const r = detectPlateau(weights, "lose", 14, 0.5);
    expect(r.plateaued).toBe(false);
  });

  it("phrasing of plateau advisory depends on the goal", () => {
    const flat = Array.from({ length: 30 }, (_, i) =>
      weighIn(`2026-05-${(i + 1).toString().padStart(2, "0")}`, 80),
    );
    expect(detectPlateau(flat, "lose").advisory).toMatch(/aiming to lose/);
    expect(detectPlateau(flat, "gain").advisory).toMatch(/aiming to gain/);
    expect(detectPlateau(flat, "maintain").advisory).toMatch(/Carry on/);
  });
});

describe("recalibrateTdee", () => {
  // Helper: build N daily weigh-ins where weight changes linearly
  // by `kgPerDay` per day.
  function series(startKg: number, kgPerDay: number, days: number) {
    return Array.from({ length: days }, (_, i) =>
      weighIn(
        `2026-05-${(i + 1).toString().padStart(2, "0")}`,
        startKg + i * kgPerDay,
      ),
    );
  }

  it("returns null advisory when there's not enough data", () => {
    const r = recalibrateTdee({
      weights: series(80, -0.05, 10),
      formulaTdee: 2400,
      dailyDelta: -500,
    });
    expect(r.advisory).toBeNull();
  });

  it("suggests a LOWER TDEE when the user is losing less than the deficit predicts", () => {
    // Eating 500 kcal under formula TDEE for 21 days should lose
    // ~1.4 kg. If they only lost 0.4 kg, real TDEE is lower.
    const weights = series(80, -0.4 / 20, 21); // ~ -0.02 kg/day
    const r = recalibrateTdee({
      weights,
      formulaTdee: 2400,
      dailyDelta: -500,
      minWindowDays: 14,
    });
    expect(r.deltaKcalPerDay).toBeLessThan(0);
    expect(r.suggestedTdee).toBeLessThan(2400);
    expect(r.advisory).toMatch(/lower/);
  });

  it("suggests a HIGHER TDEE when the user is losing more than the deficit predicts", () => {
    // Eating 500 kcal under TDEE for 21 days should lose ~1.4 kg.
    // If they actually lost 2.4 kg, real TDEE is higher.
    const weights = series(80, -2.4 / 20, 21);
    const r = recalibrateTdee({
      weights,
      formulaTdee: 2400,
      dailyDelta: -500,
      minWindowDays: 14,
    });
    expect(r.deltaKcalPerDay).toBeGreaterThan(0);
    expect(r.suggestedTdee).toBeGreaterThan(2400);
    expect(r.advisory).toMatch(/higher/);
  });

  it("returns null advisory when the suggested change is within the noise floor", () => {
    // Weight change matches expectation almost exactly → tiny error → no advisory.
    const days = 21;
    const dailyDelta = -500;
    const expectedKgChange = (dailyDelta * days) / 7700; // -1.36 kg
    const weights = series(80, expectedKgChange / (days - 1), days);
    const r = recalibrateTdee({
      weights,
      formulaTdee: 2400,
      dailyDelta,
      minWindowDays: 14,
      noiseFloorKcal: 50,
    });
    expect(Math.abs(r.deltaKcalPerDay)).toBeLessThan(50);
    expect(r.advisory).toBeNull();
  });

  it("rounds suggested TDEE to the nearest 10 kcal", () => {
    const weights = series(80, -0.05, 21);
    const r = recalibrateTdee({
      weights,
      formulaTdee: 2347, // intentionally off-round
      dailyDelta: -500,
      minWindowDays: 14,
    });
    // Use Math.abs so the assertion works for negative multiples
    // too — JS's `%` returns `-0` for negative dividends, which
    // `toBe(0)` (Object.is) treats as distinct from `0`.
    expect(Math.abs(r.suggestedTdee) % 10).toBe(0);
    expect(Math.abs(r.deltaKcalPerDay) % 10).toBe(0);
  });
});
