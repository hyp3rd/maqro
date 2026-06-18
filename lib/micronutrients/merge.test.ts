import { describe, expect, it } from "vitest";
import {
  mergeMicronutrientProfile,
  pickWinnerProfile,
  sourceRank,
  type MergeableProfile,
} from "./merge";
import type { MicronutrientProfile } from "./types";

function mp(
  source: MergeableProfile["source"],
  values: MergeableProfile["values"],
  extra: Partial<MergeableProfile> = {},
): MergeableProfile {
  return { source, values, sourceCode: null, breakdown: null, ...extra };
}

function profile(
  source: MicronutrientProfile["source"],
  enrichedAt: number,
  extra: Partial<MicronutrientProfile> = {},
): MicronutrientProfile {
  return { nameKey: "x", source, valuesPer100g: {}, enrichedAt, ...extra };
}

describe("sourceRank", () => {
  it("ranks barcode > ciqual > search > ai > miss", () => {
    expect(sourceRank("barcode")).toBeGreaterThan(sourceRank("ciqual"));
    expect(sourceRank("ciqual")).toBeGreaterThan(sourceRank("search"));
    expect(sourceRank("search")).toBeGreaterThan(sourceRank("ai"));
    expect(sourceRank("ai")).toBeGreaterThan(sourceRank("miss"));
  });
});

describe("pickWinnerProfile", () => {
  it("keeps the highest source rank regardless of recency", () => {
    const win = pickWinnerProfile([
      profile("ai", 100, { nameKey: "ai-new" }),
      profile("barcode", 1, { nameKey: "barcode-old" }),
    ]);
    expect(win.nameKey).toBe("barcode-old"); // barcode beats a newer AI guess
  });

  it("breaks ties on the same source by most-recent enrichedAt", () => {
    const win = pickWinnerProfile([
      profile("search", 50, { nameKey: "older" }),
      profile("search", 80, { nameKey: "newer" }),
    ]);
    expect(win.nameKey).toBe("newer");
  });

  it("returns the sole profile unchanged", () => {
    const only = profile("ciqual", 10, { nameKey: "solo" });
    expect(pickWinnerProfile([only])).toBe(only);
  });

  it("is order-independent", () => {
    const rows = [
      profile("ai", 100, { nameKey: "ai" }),
      profile("ciqual", 20, { nameKey: "ciqual" }),
      profile("search", 90, { nameKey: "search" }),
    ];
    expect(pickWinnerProfile(rows).nameKey).toBe("ciqual");
    expect(pickWinnerProfile([...rows].reverse()).nameKey).toBe("ciqual");
  });
});

describe("mergeMicronutrientProfile", () => {
  it("upgrades ai -> search (real data found on refresh)", () => {
    const out = mergeMicronutrientProfile(
      mp("ai", { iron: 9 }),
      mp("search", { iron: 7, zinc: 3 }),
    );
    expect(out).toEqual({
      source: "search",
      values: { iron: 7, zinc: 3 },
      sourceCode: null,
      breakdown: null,
    });
  });

  it("refreshes same-source values and coalesces the breakdown", () => {
    const out = mergeMicronutrientProfile(
      mp("search", { iron: 5 }, { breakdown: { sugars: 10 } }),
      mp("search", { iron: 6 }),
    );
    expect(out?.values).toEqual({ iron: 6 }); // newer values
    expect(out?.breakdown).toEqual({ sugars: 10 }); // kept (resolved had none)
  });

  it("never downgrades — a worse/miss resolve keeps the existing (returns null)", () => {
    const out = mergeMicronutrientProfile(
      mp("search", { iron: 5 }),
      mp("miss", {}),
    );
    expect(out).toBeNull();
  });

  it("an empty-value upgrade does NOT wipe existing micro coverage", () => {
    // A barcode product with a label but no listed micronutrients must not blank
    // the search-derived iron — keep the micros, just backfill the breakdown.
    const out = mergeMicronutrientProfile(
      mp("search", { iron: 5 }),
      mp("barcode", {}, { breakdown: { sugars: 12 }, sourceCode: "123" }),
    );
    expect(out?.source).toBe("search"); // micros source unchanged
    expect(out?.values).toEqual({ iron: 5 }); // not wiped
    expect(out?.breakdown).toEqual({ sugars: 12 }); // breakdown backfilled
  });

  it("never blanks a non-null breakdown when the new source carries none", () => {
    const out = mergeMicronutrientProfile(
      mp("search", { iron: 5 }, { breakdown: { sugars: 9 } }),
      mp("barcode", { iron: 6 }, { sourceCode: "abc" }), // no breakdown
    );
    expect(out?.source).toBe("barcode");
    expect(out?.breakdown).toEqual({ sugars: 9 }); // preserved
    expect(out?.sourceCode).toBe("abc");
  });

  it("never blanks source_code on a same-rank refresh", () => {
    const out = mergeMicronutrientProfile(
      mp("barcode", { iron: 5 }, { sourceCode: "111" }),
      mp("barcode", { iron: 6 }), // sourceCode null
    );
    expect(out?.sourceCode).toBe("111");
  });
});
