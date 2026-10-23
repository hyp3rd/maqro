import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { formatNumber, NO_FIGURE, roundTo } from "./number";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("roundTo", () => {
  it("rounds half up at the given precision", () => {
    expect(roundTo(161.6, 0)).toBe(162);
    expect(roundTo(160.4, 0)).toBe(160);
    expect(roundTo(160.5, 0)).toBe(161);
    expect(roundTo(13.25, 1)).toBe(13.3);
    expect(roundTo(13.24, 1)).toBe(13.2);
  });

  it("returns a figure too large to scale unchanged, not Infinity", () => {
    // MAX_VALUE * 100 overflows; a number that large has no fraction
    // digits left to round.
    expect(roundTo(Number.MAX_VALUE, 2)).toBe(Number.MAX_VALUE);
    expect(roundTo(-Number.MAX_VALUE, 1)).toBe(-Number.MAX_VALUE);
  });

  it("accepts only the readout precisions", () => {
    expectTypeOf(roundTo).parameter(1).toEqualTypeOf<0 | 1 | 2>();
  });
});

describe("formatNumber", () => {
  it("groups thousands the English way in en", () => {
    expect(formatNumber(1234.4, "en")).toBe("1,234");
    expect(formatNumber(12345.6, "en")).toBe("12,346");
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });

  it("groups the Italian way in it, never with an English comma", () => {
    // CLDR: Italian groups from five digits (minimumGroupingDigits 2), so a
    // four-digit figure stays ungrouped rather than reading "1,234".
    expect(formatNumber(1234.4, "it")).toBe("1234");
    expect(formatNumber(12345.6, "it")).toBe("12.346");
    expect(formatNumber(1234567, "it")).toBe("1.234.567");
  });

  it("shows exactly the requested decimals with the locale's decimal mark", () => {
    expect(formatNumber(13.25, "en", 1)).toBe("13.3");
    expect(formatNumber(40, "en", 1)).toBe("40.0");
    expect(formatNumber(13.25, "it", 1)).toBe("13,3");
  });

  it("rounds whole numbers by default", () => {
    expect(formatNumber(84.5, "en")).toBe("85");
    expect(formatNumber(0, "it")).toBe("0");
  });

  it("shows the placeholder for a value that is not a finite number", () => {
    for (const decimals of [0, 1, 2] as const) {
      for (const locale of ["en", "it"]) {
        expect(formatNumber(Number.NaN, locale, decimals)).toBe(NO_FIGURE);
        expect(formatNumber(Infinity, locale, decimals)).toBe(NO_FIGURE);
        expect(formatNumber(-Infinity, locale, decimals)).toBe(NO_FIGURE);
      }
    }
  });

  it("formats the largest finite figures instead of overflowing to the placeholder", () => {
    const exact = new Intl.NumberFormat("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.MAX_VALUE);
    expect(formatNumber(Number.MAX_VALUE, "en", 2)).toBe(exact);
    expect(formatNumber(Number.MAX_VALUE, "en", 2)).not.toBe(NO_FIGURE);
  });

  it("accepts only the readout precisions", () => {
    // Intl.NumberFormat throws a RangeError for fraction digits outside
    // 0-100, so an arbitrary number must not type-check here.
    expectTypeOf(formatNumber)
      .parameter(2)
      .toEqualTypeOf<0 | 1 | 2 | undefined>();
  });

  it("builds one formatter per locale and precision, not one per call", () => {
    // en-GB and en-AU are used by no other test, so their formatters are
    // not cached yet when the spy starts counting.
    const construct = vi.spyOn(Intl, "NumberFormat");
    expect(formatNumber(1234.567, "en-GB", 2)).toBe("1,234.57");
    expect(formatNumber(0.5, "en-GB", 2)).toBe("0.50");
    expect(formatNumber(98765.4321, "en-GB", 2)).toBe("98,765.43");
    expect(construct).toHaveBeenCalledTimes(1);
    // A different precision or locale is a formatter of its own.
    expect(formatNumber(1234.567, "en-GB", 1)).toBe("1,234.6");
    expect(formatNumber(1234.567, "en-GB", 1)).toBe("1,234.6");
    expect(construct).toHaveBeenCalledTimes(2);
    expect(formatNumber(1234.567, "en-AU", 2)).toBe("1,234.57");
    expect(formatNumber(1234.567, "en-AU", 2)).toBe("1,234.57");
    expect(construct).toHaveBeenCalledTimes(3);
  });
});
