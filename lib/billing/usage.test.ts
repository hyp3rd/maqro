import { describe, expect, it } from "vitest";
import { currentPeriodStart, FREE_AI_CAP_PER_MONTH } from "./usage";

describe("currentPeriodStart", () => {
  it("returns the first day of the UTC month in YYYY-MM-DD form", () => {
    expect(currentPeriodStart(new Date("2026-05-17T23:00:00Z"))).toBe(
      "2026-05-01",
    );
    expect(currentPeriodStart(new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01-01",
    );
    // Right at the month boundary in UTC: month index flips at 00:00 UTC.
    expect(currentPeriodStart(new Date("2026-02-28T23:59:59Z"))).toBe(
      "2026-02-01",
    );
    expect(currentPeriodStart(new Date("2026-03-01T00:00:01Z"))).toBe(
      "2026-03-01",
    );
  });

  it("zero-pads single-digit months", () => {
    expect(currentPeriodStart(new Date("2026-09-15T12:00:00Z"))).toBe(
      "2026-09-01",
    );
  });
});

describe("FREE_AI_CAP_PER_MONTH", () => {
  it("is a positive integer (sanity check — change me deliberately)", () => {
    expect(Number.isInteger(FREE_AI_CAP_PER_MONTH)).toBe(true);
    expect(FREE_AI_CAP_PER_MONTH).toBeGreaterThan(0);
  });
});
