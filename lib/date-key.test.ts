import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDateKey, localDateOfKey } from "@maqro/core/date";

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

describe("localDateOfKey", () => {
  /** West of UTC, a key parsed as UTC midnight lands on the evening before. */
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = savedTz;
  });

  it("is local midnight of the key's own calendar day", () => {
    const dt = localDateOfKey("2026-10-22");
    expect(dt).not.toBeNull();
    expect([dt?.getFullYear(), dt?.getMonth(), dt?.getDate()]).toEqual([
      2026, 9, 22,
    ]);
    expect([dt?.getHours(), dt?.getMinutes()]).toEqual([0, 0]);
  });

  it.each(["", "2026-02-30", "2026-6-4", "2026-06-04T00:00:00Z"])(
    "is null for %j",
    (s) => {
      expect(localDateOfKey(s)).toBeNull();
    },
  );
});
