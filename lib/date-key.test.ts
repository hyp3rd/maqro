import { describe, expect, it } from "vitest";
import { isDateKey } from "@maqro/core/date";

describe("isDateKey", () => {
  it.each([
    "2026-06-04",
    "2024-02-29", // leap day
    "1999-12-31",
  ])("accepts the real calendar day %s", (s) => {
    expect(isDateKey(s)).toBe(true);
  });

  it.each([
    "", // a cleared <input type="date">
    "2026-6-4",
    "2026-06-04T00:00:00Z",
    " 2026-06-04",
    "2026-02-30",
    "2025-02-29", // not a leap year
    "2026-13-01",
    "2026-00-10",
    "2026-06-00",
  ])("rejects %j", (s) => {
    expect(isDateKey(s)).toBe(false);
  });

  it("rejects non-strings read back from an untyped blob", () => {
    for (const v of [undefined, null, 20260604, {}, ["2026-06-04"]]) {
      expect(isDateKey(v)).toBe(false);
    }
  });
});
