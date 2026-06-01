import { describe, expect, it } from "vitest";
import { sanitizeEstimate } from "./ai-estimate";

describe("sanitizeEstimate", () => {
  it("keeps finite non-negative values for known nutrient keys", () => {
    const out = sanitizeEstimate({ iron: 2.7, calcium: 120, vitaminC: 30 });
    expect(out.iron).toBe(2.7);
    expect(out.calcium).toBe(120);
    expect(out.vitaminC).toBe(30);
  });

  it("drops non-numeric, NaN, and negative values", () => {
    const out = sanitizeEstimate({
      iron: "2.7",
      zinc: NaN,
      calcium: -5,
      magnesium: 50,
    });
    expect(out.iron).toBeUndefined();
    expect(out.zinc).toBeUndefined();
    expect(out.calcium).toBeUndefined();
    expect(out.magnesium).toBe(50);
  });

  it("ignores unknown keys the model might hallucinate", () => {
    const out = sanitizeEstimate({ iron: 2, vitaminK: 80, sodium: 100 });
    expect(out.iron).toBe(2);
    expect(out.sodium).toBe(100);
    expect("vitaminK" in out).toBe(false);
  });

  it("rejects absurd values above 10× the Daily Value (hallucination guard)", () => {
    // iron DV is 18 mg → ceiling 180. 9000 is rejected; 50 is kept.
    const out = sanitizeEstimate({ iron: 9000, magnesium: 50 });
    expect(out.iron).toBeUndefined();
    expect(out.magnesium).toBe(50);
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeEstimate(null)).toEqual({});
    expect(sanitizeEstimate("oops")).toEqual({});
    expect(sanitizeEstimate(undefined)).toEqual({});
  });
});
