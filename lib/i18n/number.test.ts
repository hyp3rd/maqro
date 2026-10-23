import { describe, expect, it } from "vitest";
import { formatNumber, roundTo } from "./number";

describe("roundTo", () => {
  it("rounds half up at the given precision", () => {
    expect(roundTo(161.6, 0)).toBe(162);
    expect(roundTo(160.4, 0)).toBe(160);
    expect(roundTo(160.5, 0)).toBe(161);
    expect(roundTo(13.25, 1)).toBe(13.3);
    expect(roundTo(13.24, 1)).toBe(13.2);
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
});
