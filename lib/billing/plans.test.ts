import { describe, expect, it } from "vitest";
import {
  effectiveMonthly,
  FEATURE_MATRIX,
  PLANS,
  yearlyDiscountPct,
} from "./plans";

describe("PLANS shape", () => {
  it("includes free, plus, and pro in order", () => {
    expect(PLANS.map((p) => p.tier)).toEqual(["free", "plus", "pro"]);
  });

  it("marks exactly one plan as recommended (the upgrade target)", () => {
    const recommended = PLANS.filter((p) => p.recommended === true);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.tier).toBe("plus");
  });

  it("has non-empty marketing copy keys on every plan", () => {
    // Keys (not literal strings) since translations live in i18n.
    for (const plan of PLANS) {
      expect(plan.nameKey.length).toBeGreaterThan(0);
      expect(plan.taglineKey.length).toBeGreaterThan(0);
      expect(plan.ctaKey.length).toBeGreaterThan(0);
      expect(plan.featureKeys.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("only the free plan has €0 pricing", () => {
    for (const plan of PLANS) {
      if (plan.tier === "free") {
        expect(plan.monthlyEur).toBe(0);
        expect(plan.yearlyEur).toBe(0);
      } else {
        expect(plan.monthlyEur).toBeGreaterThan(0);
        expect(plan.yearlyEur).toBeGreaterThan(0);
      }
    }
  });
});

describe("effectiveMonthly", () => {
  it("returns 0 for the free plan in both cycles", () => {
    const free = PLANS.find((p) => p.tier === "free");
    expect(free).toBeDefined();
    if (!free) return;
    expect(effectiveMonthly(free, "monthly")).toBe(0);
    expect(effectiveMonthly(free, "yearly")).toBe(0);
  });

  it("returns the raw monthly price for paid plans on the monthly cycle", () => {
    const plus = PLANS.find((p) => p.tier === "plus");
    expect(plus).toBeDefined();
    if (!plus) return;
    expect(effectiveMonthly(plus, "monthly")).toBe(plus.monthlyEur);
  });

  it("amortizes the yearly price across 12 months on the yearly cycle", () => {
    const pro = PLANS.find((p) => p.tier === "pro");
    expect(pro).toBeDefined();
    if (!pro) return;
    expect(effectiveMonthly(pro, "yearly")).toBeCloseTo(pro.yearlyEur / 12, 5);
  });
});

describe("yearlyDiscountPct", () => {
  it("is 0 for the free plan (no discount to compute)", () => {
    const free = PLANS.find((p) => p.tier === "free");
    expect(free).toBeDefined();
    if (!free) return;
    expect(yearlyDiscountPct(free)).toBe(0);
  });

  it("is the marketing-claimed ~20% off for paid plans", () => {
    // The marketing copy ("Save ~20%") and the pricing table both
    // depend on this. If we change a yearly price, this test pins
    // the displayed claim to reality.
    for (const plan of PLANS) {
      if (plan.monthlyEur === 0) continue;
      const pct = yearlyDiscountPct(plan);
      expect(pct).toBeGreaterThanOrEqual(15);
      expect(pct).toBeLessThanOrEqual(25);
    }
  });
});

describe("FEATURE_MATRIX shape", () => {
  it("has at least one row per declared section", () => {
    const sections = new Set(FEATURE_MATRIX.map((r) => r.section));
    expect(sections.has("core")).toBe(true);
    expect(sections.has("aiFeatures")).toBe(true);
    expect(sections.has("syncData")).toBe(true);
    expect(sections.has("communication")).toBe(true);
    expect(sections.has("support")).toBe(true);
  });

  it("each cell is a boolean or a non-empty string", () => {
    for (const row of FEATURE_MATRIX) {
      for (const cell of [row.free, row.plus, row.pro]) {
        if (typeof cell === "string") {
          expect(cell.length).toBeGreaterThan(0);
        } else {
          expect(typeof cell).toBe("boolean");
        }
      }
    }
  });

  it("never grants the free tier a feature the paid tiers lack", () => {
    // Sanity: it would be a presentation bug for the comparison to
    // show free=true and plus=false on a non-quantitative row. Caps
    // and limits (string cells) are excluded - "25" vs "500" is
    // legitimately the same feature with different bounds.
    for (const row of FEATURE_MATRIX) {
      if (
        typeof row.free === "boolean" &&
        typeof row.plus === "boolean" &&
        typeof row.pro === "boolean"
      ) {
        if (row.free) {
          expect(row.plus).toBe(true);
          expect(row.pro).toBe(true);
        }
        if (row.plus) {
          expect(row.pro).toBe(true);
        }
      }
    }
  });
});
