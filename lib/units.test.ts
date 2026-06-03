import { describe, expect, it } from "vitest";
import {
  cmToDisplay,
  cmToFeetInches,
  cmToInches,
  detectDefaultUnitSystem,
  displayToCm,
  displayToKg,
  displayToMl,
  feetInchesToCm,
  flOzToMl,
  formatHeight,
  formatVolume,
  formatWeight,
  formatWeightRate,
  inchesToCm,
  kgToDisplay,
  kgToLb,
  lbToKg,
  mlToDisplay,
  mlToFlOz,
  volumeUnitSuffix,
} from "./units";

/** The conversion factors are the spec — every other helper rests
 *  on them. We pin a handful of textbook reference points so a
 *  typo in `KG_PER_LB` or `CM_PER_INCH` would surface immediately
 *  rather than as a drift in someone's weight chart months later. */
describe("kg ↔ lb", () => {
  it("matches the avoirdupois pound reference", () => {
    // 100 kg ≈ 220.46 lb. Tight tolerance — the conversion is exact.
    expect(kgToLb(100)).toBeCloseTo(220.4623, 3);
    // 200 lb ≈ 90.72 kg.
    expect(lbToKg(200)).toBeCloseTo(90.7185, 3);
  });

  it("round-trips losslessly", () => {
    for (const kg of [50, 70.5, 100, 145.3]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 6);
    }
  });
});

describe("cm ↔ inches", () => {
  it("matches the international inch reference", () => {
    // 1 in = 2.54 cm exactly.
    expect(inchesToCm(1)).toBe(2.54);
    expect(cmToInches(2.54)).toBeCloseTo(1, 10);
    // 6 ft = 72 in = 182.88 cm.
    expect(inchesToCm(72)).toBeCloseTo(182.88, 6);
  });

  it("round-trips losslessly", () => {
    for (const cm of [150, 175, 180, 195]) {
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 6);
    }
  });
});

describe("cmToFeetInches", () => {
  it("splits an exact value cleanly", () => {
    // 6'0" = 182.88 cm
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
  });

  it("rounds the inches component to the nearest whole inch", () => {
    // 5'11" = 180.34 cm; 180 cm rounds to 5'11".
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 });
  });

  it("rolls inches=12 up to the next foot (no `5'12\"` output)", () => {
    // 182.5 cm = ~5'11.85", which would naively round to 5'12".
    // The helper should bump it to 6'0".
    const result = cmToFeetInches(182.5);
    expect(result.inches).toBeLessThan(12);
    expect(result).toEqual({ feet: 6, inches: 0 });
  });

  it("inverts feetInchesToCm within 1cm", () => {
    for (const [feet, inches] of [
      [5, 7],
      [5, 11],
      [6, 0],
      [6, 4],
    ]) {
      const cm = feetInchesToCm(feet ?? 0, inches ?? 0);
      const split = cmToFeetInches(cm);
      expect(split).toEqual({ feet, inches });
    }
  });
});

describe("display formatters", () => {
  it("formats weight to one decimal in the requested system", () => {
    expect(formatWeight(75, "metric")).toBe("75.0 kg");
    // 75 kg ≈ 165.3 lb.
    expect(formatWeight(75, "imperial")).toBe("165.3 lb");
  });

  it("formats height as ft'in\" in imperial, whole cm in metric", () => {
    expect(formatHeight(180, "metric")).toBe("180 cm");
    expect(formatHeight(180, "imperial")).toBe("5'11\"");
  });

  it("signs the weight-rate string", () => {
    expect(formatWeightRate(0.5, "metric")).toBe("+0.50 kg/week");
    expect(formatWeightRate(0, "metric")).toBe("0.00 kg/week");
    expect(formatWeightRate(-0.5, "metric")).toBe("-0.50 kg/week");
    // 0.5 kg ≈ 1.10 lb.
    expect(formatWeightRate(0.5, "imperial")).toBe("+1.10 lb/week");
  });
});

describe("kgToDisplay / displayToKg round-trips", () => {
  it("metric is the identity (modulo 1dp rounding)", () => {
    expect(kgToDisplay(70.34, "metric")).toBe(70.3);
    expect(displayToKg(70.3, "metric")).toBe(70.3);
  });

  it("imperial round-trips within ≤0.05 kg", () => {
    // 1 dp on lb is < 0.05 kg of precision loss — fine for weight
    // tracking, invisible to the user.
    for (const kg of [60, 75.5, 100, 145.2]) {
      const lb = kgToDisplay(kg, "imperial");
      const back = displayToKg(lb, "imperial");
      expect(Math.abs(back - kg)).toBeLessThan(0.05);
    }
  });
});

describe("cmToDisplay / displayToCm", () => {
  it("metric returns whole cm", () => {
    expect(cmToDisplay(180.4, "metric")).toBe(180);
    expect(displayToCm(180, "metric")).toBe(180);
  });

  it("imperial converts to whole inches and back", () => {
    // 180 cm ≈ 70.87 in → rounds to 71.
    expect(cmToDisplay(180, "imperial")).toBe(71);
    // 71 in = 180.34 cm.
    expect(displayToCm(71, "imperial")).toBeCloseTo(180.34, 2);
  });
});

describe("ml ↔ fl oz", () => {
  it("converts at the US fluid-ounce factor (29.5735 ml)", () => {
    // 1 fl oz = 29.5735 ml.
    expect(flOzToMl(1)).toBeCloseTo(29.5735, 4);
    expect(mlToFlOz(29.5735)).toBeCloseTo(1, 6);
    // A 500 ml bottle ≈ 16.9 fl oz.
    expect(mlToFlOz(500)).toBeCloseTo(16.907, 2);
  });
});

describe("mlToDisplay / displayToMl", () => {
  it("metric returns whole ml and round-trips", () => {
    expect(mlToDisplay(2350, "metric")).toBe(2350);
    expect(displayToMl(2350, "metric")).toBe(2350);
  });

  it("imperial converts to whole fl oz and back", () => {
    // 2400 ml ≈ 81.15 fl oz → rounds to 81.
    expect(mlToDisplay(2400, "imperial")).toBe(81);
    // 81 fl oz ≈ 2395 ml.
    expect(displayToMl(81, "imperial")).toBe(2395);
  });
});

describe("formatVolume", () => {
  it("metric shows ml below a litre and L at/above", () => {
    expect(formatVolume(750, "metric")).toBe("750 ml");
    expect(formatVolume(2000, "metric")).toBe("2 L");
    expect(formatVolume(2400, "metric")).toBe("2.4 L");
  });

  it("imperial shows whole fluid ounces", () => {
    expect(formatVolume(2400, "imperial")).toBe("81 fl oz");
    expect(formatVolume(250, "imperial")).toBe("8 fl oz");
  });
});

describe("volumeUnitSuffix", () => {
  it("maps to the unit label", () => {
    expect(volumeUnitSuffix("metric")).toBe("ml");
    expect(volumeUnitSuffix("imperial")).toBe("fl oz");
  });
});

describe("detectDefaultUnitSystem", () => {
  // We can't easily stub `navigator.languages` in a node context
  // without polluting globalThis; instead we lean on the documented
  // behaviour for the SSR fallback path.
  it("defaults to metric when navigator is unavailable", () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    delete (globalThis as { navigator?: unknown }).navigator;
    try {
      expect(detectDefaultUnitSystem()).toBe("metric");
    } finally {
      (globalThis as { navigator?: unknown }).navigator = originalNavigator;
    }
  });
});
