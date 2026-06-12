import { describe, expect, it } from "vitest";
import {
  medianBreakdown,
  offCodeFromFoodId,
  offHitToBreakdown,
  offHitToMicronutrients,
  type OFFHit,
} from "@maqro/core/off";

function hit(nutriments: NonNullable<OFFHit["nutriments"]>): OFFHit {
  return { product_name: "Test", nutriments } as OFFHit;
}

describe("offHitToMicronutrients — sodium from salt", () => {
  it("derives sodium from a salt-only row (salt / 2.5, grams → mg)", () => {
    // 1.5 g salt per 100 g → 0.6 g sodium → 600 mg.
    const out = offHitToMicronutrients(hit({ salt_100g: 1.5 }));
    expect(out.sodium).toBeCloseTo(600);
  });

  it("prefers the explicit sodium field over salt", () => {
    const out = offHitToMicronutrients(hit({ sodium_100g: 0.4, salt_100g: 9 }));
    expect(out.sodium).toBeCloseTo(400);
  });

  it("leaves sodium absent when neither field exists", () => {
    const out = offHitToMicronutrients(hit({ calcium_100g: 0.1 }));
    expect(out.sodium).toBeUndefined();
    expect(out.calcium).toBeCloseTo(100);
  });
});

describe("offHitToBreakdown", () => {
  it("extracts the per-100g sub-macros that are present", () => {
    const out = offHitToBreakdown(
      hit({ sugars_100g: 12, fiber_100g: 3.4, "saturated-fat_100g": 1.2 }),
    );
    expect(out).toEqual({ sugars: 12, fiber: 3.4, saturatedFat: 1.2 });
  });

  it("returns {} for a row with no breakdown fields", () => {
    expect(offHitToBreakdown(hit({ sodium_100g: 0.1 }))).toEqual({});
  });
});

describe("medianBreakdown", () => {
  it("takes the per-key median across hits, ignoring absent values", () => {
    const out = medianBreakdown([
      hit({ sugars_100g: 10, fiber_100g: 2 }),
      hit({ sugars_100g: 30 }),
      hit({ sugars_100g: 20, fiber_100g: 4 }),
    ]);
    expect(out.sugars).toBe(20); // median of 10/20/30
    expect(out.fiber).toBe(3); // mean of the middle pair (2, 4)
    expect(out.saturatedFat).toBeUndefined();
  });
});

describe("offCodeFromFoodId", () => {
  it("extracts the code from an off: id", () => {
    expect(offCodeFromFoodId("off:3017620422003")).toBe("3017620422003");
  });

  it("rejects non-OFF ids and malformed codes", () => {
    expect(offCodeFromFoodId("ciqual:12345")).toBeUndefined();
    expect(offCodeFromFoodId(undefined)).toBeUndefined();
    expect(offCodeFromFoodId("off:not-a-code")).toBeUndefined();
    expect(offCodeFromFoodId("off:123")).toBeUndefined(); // too short
  });
});
