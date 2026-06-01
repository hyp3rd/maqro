import { describe, expect, it } from "vitest";
import {
  SHOPPING_AISLES,
  categorizeFallback,
  categoryCounts,
  tallyAisles,
} from "./categorize";

describe("categorizeFallback", () => {
  it("maps common items to sensible aisles", () => {
    expect(categorizeFallback("Brown Rice")).toBe("Pantry & Dry Goods");
    expect(categorizeFallback("Chicken Breast")).toBe("Meat & Seafood");
    expect(categorizeFallback("Whole Milk")).toBe("Dairy & Eggs");
    expect(categorizeFallback("Bananas")).toBe("Produce");
    expect(categorizeFallback("Sourdough Bread")).toBe("Bakery");
    expect(categorizeFallback("Sparkling Water")).toBe("Beverages");
    expect(categorizeFallback("Frozen Peas")).toBe("Frozen");
    expect(categorizeFallback("Dish Soap")).toBe("Household");
  });

  it("is case-insensitive and matches within longer names", () => {
    expect(categorizeFallback("ORGANIC baby spinach")).toBe("Produce");
  });

  it("falls back to Other when nothing matches", () => {
    expect(categorizeFallback("Mystery Item 9000")).toBe("Other");
  });

  it("only ever returns a known aisle", () => {
    for (const name of ["rice", "zzz", "Eggs", "kombucha"]) {
      expect(SHOPPING_AISLES).toContain(categorizeFallback(name));
    }
  });
});

describe("categoryCounts", () => {
  it("tallies names into their aisles with every aisle present", () => {
    const counts = categoryCounts(["Brown Rice", "Pasta", "Milk", "Mystery"]);
    expect(counts["Pantry & Dry Goods"]).toBe(2); // rice + pasta
    expect(counts["Dairy & Eggs"]).toBe(1);
    expect(counts.Other).toBe(1);
    expect(counts.Frozen).toBe(0);
    // All aisles are keys, even at zero.
    for (const aisle of SHOPPING_AISLES) {
      expect(counts[aisle]).toBeGreaterThanOrEqual(0);
    }
  });

  it("is empty (all zero) for no names", () => {
    const counts = categoryCounts([]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe("tallyAisles", () => {
  it("counts pre-resolved aisles (honouring overrides)", () => {
    const counts = tallyAisles(["Produce", "Produce", "Frozen"]);
    expect(counts.Produce).toBe(2);
    expect(counts.Frozen).toBe(1);
    expect(counts.Other).toBe(0);
  });
});
