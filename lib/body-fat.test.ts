import { describe, expect, it } from "vitest";
import {
  bodyFatCategory,
  bodyFatBodyType,
  estimateBodyFat,
  hasBodyFatInputs,
  latestBodyFatPct,
  latestBodyFatReading,
} from "./body-fat";

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

/** The ONE derivation of the body-fat % the targets read (`TargetContext.
 *  bodyFatPct`): the app, /report and both crons pass its result, so they
 *  can never disagree on a training-day protein target. */
describe("latestBodyFatPct", () => {
  const MALE = { gender: "male" as const, heightCm: 178 };
  const FEMALE = { gender: "female" as const, heightCm: 165 };
  const male = (waistCm: number, neckCm: number) =>
    estimateBodyFat({ bodyType: "male", heightCm: 178, waistCm, neckCm });

  it("estimates from the latest measurement, whatever the input order", () => {
    const rows = [
      { date: "2026-10-20", waistCm: 84, neckCm: 38 },
      { date: "2026-09-01", waistCm: 92, neckCm: 38 },
      { date: "2026-10-01", waistCm: 88, neckCm: 38 },
    ];
    expect(latestBodyFatPct(rows, MALE)).toBe(male(84, 38));
    expect(latestBodyFatPct([...rows].reverse(), MALE)).toBe(male(84, 38));
  });

  it("skips newer rows that lack the formula's inputs (waist-only check-ins)", () => {
    const rows = [
      { date: "2026-10-01", waistCm: 88, neckCm: 38 },
      { date: "2026-10-20", waistCm: 84 },
      { date: "2026-10-22", waistCm: 83, neckCm: null, hipsCm: null },
    ];
    expect(latestBodyFatPct(rows, MALE)).toBe(male(88, 38));
  });

  it("needs hips for the female formula", () => {
    const rows = [
      { date: "2026-10-01", waistCm: 74, neckCm: 33, hipsCm: 98 },
      { date: "2026-10-20", waistCm: 72, neckCm: 33 },
    ];
    expect(latestBodyFatPct(rows, FEMALE)).toBe(
      estimateBodyFat({
        bodyType: "female",
        heightCm: 165,
        waistCm: 74,
        neckCm: 33,
        hipCm: 98,
      }),
    );
  });

  it("does not fall back to an older row when the latest one is implausible", () => {
    // Waist under neck: the latest complete reading is a measurement error,
    // and an older estimate would describe a body that has since changed.
    const rows = [
      { date: "2026-10-01", waistCm: 88, neckCm: 38 },
      { date: "2026-10-20", waistCm: 30, neckCm: 38 },
    ];
    expect(latestBodyFatPct(rows, MALE)).toBeNull();
  });

  it("is null with no usable measurement, or with no published formula", () => {
    expect(latestBodyFatPct([], MALE)).toBeNull();
    expect(
      latestBodyFatPct([{ date: "2026-10-01", waistCm: 88 }], MALE),
    ).toBeNull();
    const rows = [{ date: "2026-10-01", waistCm: 88, neckCm: 38, hipsCm: 99 }];
    expect(
      latestBodyFatPct(rows, { gender: "nonbinary", heightCm: 178 }),
    ).toBeNull();
    expect(
      latestBodyFatPct(rows, { gender: "preferNotToSay", heightCm: 178 }),
    ).toBeNull();
  });
});

/** The reading behind `latestBodyFatPct`, for the displays (Progress,
 *  /report) that show the same estimate the targets read and say which
 *  measurement it comes from. */
describe("latestBodyFatReading", () => {
  const MALE = { gender: "male" as const, heightCm: 178 };

  it("is the latest complete reading's estimate and date — latestBodyFatPct's", () => {
    const rows = [
      { date: "2026-10-01", waistCm: 88, neckCm: 38 },
      { date: "2026-10-20", waistCm: 84 },
    ];
    const reading = latestBodyFatReading(rows, MALE);
    expect(reading).toEqual({
      pct: estimateBodyFat({
        bodyType: "male",
        heightCm: 178,
        waistCm: 88,
        neckCm: 38,
      }),
      date: "2026-10-01",
    });
    expect(reading?.pct).toBe(latestBodyFatPct(rows, MALE));
  });

  it("is null exactly when latestBodyFatPct is", () => {
    const implausible = [
      { date: "2026-10-01", waistCm: 88, neckCm: 38 },
      { date: "2026-10-20", waistCm: 30, neckCm: 38 },
    ];
    expect(latestBodyFatReading(implausible, MALE)).toBeNull();
    expect(latestBodyFatReading([], MALE)).toBeNull();
    expect(
      latestBodyFatReading(implausible, { gender: "nonbinary", heightCm: 178 }),
    ).toBeNull();
  });
});

describe("bodyFatBodyType / hasBodyFatInputs", () => {
  it("maps only the two genders with a published formula", () => {
    expect(bodyFatBodyType("male")).toBe("male");
    expect(bodyFatBodyType("female")).toBe("female");
    expect(bodyFatBodyType("nonbinary")).toBeNull();
    expect(bodyFatBodyType("preferNotToSay")).toBeNull();
  });

  it("requires positive waist + neck, and hips for female", () => {
    const row = { date: "d", waistCm: 80, neckCm: 37 };
    expect(hasBodyFatInputs(row, "male")).toBe(true);
    expect(hasBodyFatInputs(row, "female")).toBe(false);
    expect(hasBodyFatInputs({ ...row, hipsCm: 95 }, "female")).toBe(true);
    expect(hasBodyFatInputs({ ...row, neckCm: 0 }, "male")).toBe(false);
    expect(hasBodyFatInputs({ ...row, waistCm: null }, "male")).toBe(false);
  });
});
