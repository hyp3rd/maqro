import { describe, expect, it } from "vitest";
import { bodyFatCategory, estimateBodyFat } from "./body-fat";

describe("estimateBodyFat (male)", () => {
  it("returns a plausible value for a typical adult male", () => {
    // 180 cm, 85 cm waist, 38 cm neck → known-good ~14%.
    const bf = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 85,
      neckCm: 38,
    });
    expect(bf).not.toBeNull();
    expect(bf).toBeGreaterThan(11);
    expect(bf).toBeLessThan(18);
  });

  it("higher waist → higher body fat (monotonic)", () => {
    const lean = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 80,
      neckCm: 38,
    });
    const heavier = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 95,
      neckCm: 38,
    });
    expect(lean).not.toBeNull();
    expect(heavier).not.toBeNull();
    expect(heavier).toBeGreaterThan(lean as number);
  });

  it("returns null when waist ≤ neck (formula domain violation)", () => {
    expect(
      estimateBodyFat({
        bodyType: "male",
        heightCm: 180,
        waistCm: 38,
        neckCm: 40,
      }),
    ).toBeNull();
  });

  it("ignores hipCm for male formula", () => {
    const without = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 85,
      neckCm: 38,
    });
    const withHip = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 85,
      neckCm: 38,
      hipCm: 100,
    });
    expect(without).toBe(withHip);
  });
});

describe("estimateBodyFat (female)", () => {
  it("returns a plausible value for a typical adult female", () => {
    // 168 cm, 75 cm waist, 33 cm neck, 95 cm hip → known-good ~25%.
    const bf = estimateBodyFat({
      bodyType: "female",
      heightCm: 168,
      waistCm: 75,
      neckCm: 33,
      hipCm: 95,
    });
    expect(bf).not.toBeNull();
    expect(bf).toBeGreaterThan(22);
    expect(bf).toBeLessThan(28);
  });

  it("requires hipCm — null without it", () => {
    expect(
      estimateBodyFat({
        bodyType: "female",
        heightCm: 168,
        waistCm: 75,
        neckCm: 33,
      }),
    ).toBeNull();
  });

  it("higher waist → higher body fat (monotonic)", () => {
    const lean = estimateBodyFat({
      bodyType: "female",
      heightCm: 168,
      waistCm: 68,
      neckCm: 33,
      hipCm: 95,
    });
    const heavier = estimateBodyFat({
      bodyType: "female",
      heightCm: 168,
      waistCm: 90,
      neckCm: 33,
      hipCm: 95,
    });
    expect(lean).not.toBeNull();
    expect(heavier).not.toBeNull();
    expect(heavier).toBeGreaterThan(lean as number);
  });
});

describe("estimateBodyFat (edge cases)", () => {
  it("returns null for negative / zero / NaN inputs", () => {
    expect(
      estimateBodyFat({
        bodyType: "male",
        heightCm: 0,
        waistCm: 85,
        neckCm: 38,
      }),
    ).toBeNull();
    expect(
      estimateBodyFat({
        bodyType: "male",
        heightCm: 180,
        waistCm: -1,
        neckCm: 38,
      }),
    ).toBeNull();
    expect(
      estimateBodyFat({
        bodyType: "male",
        heightCm: NaN,
        waistCm: 85,
        neckCm: 38,
      }),
    ).toBeNull();
  });

  it("returns null when output would be physiologically implausible", () => {
    // Extreme inputs producing an absurd reading clamp to null.
    const bf = estimateBodyFat({
      bodyType: "male",
      heightCm: 50,
      waistCm: 200,
      neckCm: 30,
    });
    expect(bf).toBeNull();
  });
});

describe("bodyFatCategory", () => {
  it("classifies male values across the ACE chart", () => {
    expect(bodyFatCategory(4, "male")).toBe("essential");
    expect(bodyFatCategory(10, "male")).toBe("athletic");
    expect(bodyFatCategory(16, "male")).toBe("fitness");
    expect(bodyFatCategory(22, "male")).toBe("average");
    expect(bodyFatCategory(30, "male")).toBe("obese");
  });

  it("classifies female values across the ACE chart", () => {
    expect(bodyFatCategory(12, "female")).toBe("essential");
    expect(bodyFatCategory(18, "female")).toBe("athletic");
    expect(bodyFatCategory(23, "female")).toBe("fitness");
    expect(bodyFatCategory(28, "female")).toBe("average");
    expect(bodyFatCategory(35, "female")).toBe("obese");
  });
});
