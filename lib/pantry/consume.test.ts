import type { PantryItem } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  consumedUnitAmount,
  crossedLow,
  isLow,
  matchPantryItem,
  planPerFoodConsumption,
  planPerFoodConsumptionAgainstBalance,
  roundQuantity,
} from "./consume";

function item(
  id: string,
  name: string,
  quantity: number,
  unit = "x",
): PantryItem {
  return { id, name, quantity, unit, createdAt: 0, updatedAt: 0 };
}

describe("matchPantryItem", () => {
  const pantry = [
    item("a", "Chicken Breast", 4),
    item("b", "Brown Rice", 1),
    item("c", "Olive Oil", 1),
  ];

  it("matches on exact normalized name (case / plural insensitive)", () => {
    expect(matchPantryItem("chicken breast", pantry)?.id).toBe("a");
    // Trailing qualifier stripped by normalizeName ("Chicken Breast, raw").
    expect(matchPantryItem("Chicken Breast, raw", pantry)?.id).toBe("a");
  });

  it("matches via word-boundary substring fallback", () => {
    // "rice" is a whole word inside "brown rice".
    expect(matchPantryItem("Rice", pantry)?.id).toBe("b");
  });

  it("does not match a substring buried in another word", () => {
    // "oil" (<4 chars) shouldn't match, and "egg" must never hit
    // "eggplant" — guard the classic false positive.
    const p = [item("e", "Eggplant", 2)];
    expect(matchPantryItem("egg", p)).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(matchPantryItem("Quinoa", pantry)).toBeUndefined();
    expect(matchPantryItem("   ", pantry)).toBeUndefined();
  });
});

describe("planPerFoodConsumption — count / free-text units", () => {
  const pantry = [
    item("a", "Chicken Breast", 4, "breasts"),
    item("b", "Brown Rice", 2, "bags"),
    item("c", "Olive Oil", 5, "bottles"),
  ];

  function uses(names: string[]) {
    // Count units ignore grams, so any positive gram value is fine.
    return names.map((name) => ({ name, grams: 100 }));
  }

  it("draws one whole unit per matched food, null for non-matches", () => {
    const draws = planPerFoodConsumption(
      uses(["Chicken Breast", "Brown Rice", "Broccoli"]),
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "a", consumedQty: 1 });
    expect(draws[1]).toEqual({ itemId: "b", consumedQty: 1 });
    expect(draws[2]).toBeNull(); // broccoli isn't in the pantry
  });

  it("draws per food across duplicate lines, capped at what's on hand", () => {
    // Two chicken lines (qty 4) → each draws one. A third on an item
    // with only 1 left draws the last unit, then null.
    const draws = planPerFoodConsumption(
      [
        { name: "Chicken Breast", grams: 100 },
        { name: "chicken breast", grams: 100 },
        { name: "Olive Oil", grams: 100 },
      ],
      [
        item("a", "Chicken Breast", 4, "breasts"),
        item("c", "Olive Oil", 1, "bottles"),
      ],
    );
    expect(draws[0]).toEqual({ itemId: "a", consumedQty: 1 });
    expect(draws[1]).toEqual({ itemId: "a", consumedQty: 1 });
    expect(draws[2]).toEqual({ itemId: "c", consumedQty: 1 });
  });

  it("stops drawing once a count item is exhausted", () => {
    const draws = planPerFoodConsumption(uses(["Eggs", "Eggs"]), [
      item("d", "Eggs", 1, "eggs"),
    ]);
    expect(draws[0]).toEqual({ itemId: "d", consumedQty: 1 });
    expect(draws[1]).toBeNull(); // none left
  });

  it("multiplies the per-food draw by the pass count", () => {
    const draws = planPerFoodConsumption(uses(["Chicken Breast"]), pantry, 3);
    expect(draws[0]).toEqual({ itemId: "a", consumedQty: 3 });
  });

  it("returns nulls when nothing matches", () => {
    expect(planPerFoodConsumption(uses(["Quinoa", "Tofu"]), pantry)).toEqual([
      null,
      null,
    ]);
  });
});

describe("planPerFoodConsumption — mass units (gram reconciliation)", () => {
  it("draws the actual grams from a kg bag, not a whole unit", () => {
    // The reported bug, per-food: 40 g out of 1 kg → draws 0.04 kg.
    const pantry = [item("p", "Protein Powder", 1, "kg")];
    const draws = planPerFoodConsumption(
      [{ name: "Protein Powder", grams: 40 }],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "p", consumedQty: 0.04 });
  });

  it("draws grams one-for-one when the unit is grams", () => {
    const pantry = [item("r", "Rolled Oats", 500, "g")];
    const draws = planPerFoodConsumption(
      [{ name: "Rolled Oats", grams: 80 }],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "r", consumedQty: 80 });
  });

  it("attributes cumulatively across lines hitting the same item", () => {
    // Two rice lines of 75 g each draw 0.075 kg apiece (0.15 kg total).
    const pantry = [item("r", "Brown Rice", 1, "kg")];
    const draws = planPerFoodConsumption(
      [
        { name: "Brown Rice", grams: 75 },
        { name: "brown rice", grams: 75 },
      ],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "r", consumedQty: 0.075 });
    expect(draws[1]).toEqual({ itemId: "r", consumedQty: 0.075 });
  });

  it("caps the second line at the remaining balance (no over-draw)", () => {
    // 0.05 kg left; two 40 g (0.04 kg) scoops → first 0.04, second only
    // the remaining 0.01. Together exactly the 0.05 that was on hand.
    const pantry = [item("p", "Protein Powder", 0.05, "kg")];
    const draws = planPerFoodConsumption(
      [
        { name: "Protein Powder", grams: 40 },
        { name: "Protein Powder", grams: 40 },
      ],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "p", consumedQty: 0.04 });
    expect(draws[1]).toEqual({ itemId: "p", consumedQty: 0.01 });
  });

  it("multiplies the gram draw by the pass count", () => {
    const pantry = [item("p", "Protein Powder", 1, "kg")];
    const draws = planPerFoodConsumption(
      [{ name: "Protein Powder", grams: 40 }],
      pantry,
      5,
    );
    expect(draws[0]).toEqual({ itemId: "p", consumedQty: 0.2 });
  });

  it("reconciles a volume unit via density (default ~1 g/ml)", () => {
    // 250 g of milk from a 2 L carton → 0.25 L (density defaults to 1).
    const pantry = [item("m", "Milk", 2, "l")];
    const draws = planPerFoodConsumption(
      [{ name: "Milk", grams: 250 }],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "m", consumedQty: 0.25 });
  });

  it("honours a per-item density for volume units", () => {
    // Oil at 0.92 g/ml: 460 g → 500 ml → 0.5 L.
    const pantry = [{ ...item("o", "Olive Oil", 1, "l"), density: 0.92 }];
    const draws = planPerFoodConsumption(
      [{ name: "Olive Oil", grams: 460 }],
      pantry,
    );
    expect(draws[0]).toEqual({ itemId: "o", consumedQty: 0.5 });
  });
});

describe("consumedUnitAmount", () => {
  it("converts grams to a mass unit", () => {
    expect(consumedUnitAmount("kg", 40)).toBe(0.04);
    expect(consumedUnitAmount("g", 80)).toBe(80);
  });

  it("multiplies by the pass count", () => {
    expect(consumedUnitAmount("kg", 40, 3)).toBe(0.12);
  });

  it("costs one whole unit for count / free-text units, ignoring grams", () => {
    expect(consumedUnitAmount("eggs", 200)).toBe(1);
    expect(consumedUnitAmount("eggs", 200, 2)).toBe(2);
    // A "scoop" isn't a known unit → whole-unit.
    expect(consumedUnitAmount("scoop", 250)).toBe(1);
  });

  it("converts grams to a volume unit via density", () => {
    // ml is one-for-one at density 1; l divides by 1000.
    expect(consumedUnitAmount("ml", 250)).toBe(250);
    expect(consumedUnitAmount("l", 250)).toBe(0.25);
    // Density shifts the conversion (oil ~0.92): 460 g → 0.5 L.
    expect(consumedUnitAmount("l", 460, 1, 0.92)).toBe(0.5);
    // A tablespoon is ~14.79 ml: 30 g (water) → ~2.029 tbsp.
    expect(consumedUnitAmount("tbsp", 30)).toBeCloseTo(2.029, 2);
  });
});

describe("crossedLow", () => {
  it("count units: crosses at the last unit", () => {
    expect(crossedLow("eggs", 2, 1, 1)).toBe(true);
    expect(crossedLow("eggs", 5, 4, 1)).toBe(false);
  });

  it("mass units: low only when it can't cover another like use", () => {
    expect(crossedLow("kg", 1, 0.96, 0.04)).toBe(false);
    expect(crossedLow("kg", 0.05, 0.01, 0.04)).toBe(true);
  });

  it("mass units: flags running out even when over-consumed", () => {
    expect(crossedLow("kg", 0.5, 0, 0.6)).toBe(true);
  });

  it("treats volume units like a measure, not a count", () => {
    // 2 L → 1.75 L isn't low (plenty left for another 0.25 L pour)…
    expect(crossedLow("l", 2, 1.75, 0.25)).toBe(false);
    // …but 0.3 L → 0.05 L can't cover another 0.25 L → low.
    expect(crossedLow("l", 0.3, 0.05, 0.25)).toBe(true);
  });

  it("never flags a restore (non-positive decrement)", () => {
    expect(crossedLow("kg", 0.5, 0.9, -0.4)).toBe(false);
  });

  it("honours a per-item threshold override (units agnostic)", () => {
    // User set 'low when ≤ 0.2 kg' on flour: 0.25 → 0.15 crosses → low.
    expect(crossedLow("kg", 0.25, 0.15, 0.1, 0.2)).toBe(true);
    // …and a further draw doesn't re-fire — we're already below.
    expect(crossedLow("kg", 0.15, 0.1, 0.05, 0.2)).toBe(false);
    // Same threshold rule applied to a count item.
    expect(crossedLow("eggs", 5, 2, 3, 3)).toBe(true);
  });
});

describe("isLow", () => {
  function item(
    id: string,
    name: string,
    quantity: number,
    unit: string,
    lowThreshold?: number,
  ) {
    return {
      id,
      name,
      quantity,
      unit,
      lowThreshold,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it("count items default to ≤ LOW_STOCK_THRESHOLD", () => {
    expect(isLow(item("a", "Eggs", 1, "eggs"))).toBe(true);
    expect(isLow(item("a", "Eggs", 2, "eggs"))).toBe(false);
  });

  it("measured items default to empty-only", () => {
    expect(isLow(item("a", "Flour", 0, "kg"))).toBe(true);
    expect(isLow(item("a", "Flour", 0.1, "kg"))).toBe(false);
  });

  it("honours a per-item threshold (any unit)", () => {
    expect(isLow(item("a", "Flour", 0.15, "kg", 0.2))).toBe(true);
    expect(isLow(item("a", "Flour", 0.5, "kg", 0.2))).toBe(false);
    expect(isLow(item("a", "Eggs", 3, "eggs", 3))).toBe(true);
  });
});

describe("planPerFoodConsumptionAgainstBalance — shared running balance", () => {
  it("threads the balance across successive calls (cap survives)", () => {
    // Three breasts, two calls of two foods each → first call gets 2,
    // second call gets the remaining 1 then null. Single-call version
    // can't express this — it always sees the full quantity.
    const pantry = [item("a", "Chicken Breast", 3, "breasts")];
    const balance = new Map(pantry.map((i) => [i.id, i.quantity] as const));
    const a = planPerFoodConsumptionAgainstBalance(
      [
        { name: "Chicken Breast", grams: 100 },
        { name: "Chicken Breast", grams: 100 },
      ],
      pantry,
      balance,
    );
    const b = planPerFoodConsumptionAgainstBalance(
      [
        { name: "Chicken Breast", grams: 100 },
        { name: "Chicken Breast", grams: 100 },
      ],
      pantry,
      balance,
    );
    expect(a[0]?.consumedQty).toBe(1);
    expect(a[1]?.consumedQty).toBe(1);
    expect(b[0]?.consumedQty).toBe(1);
    expect(b[1]).toBeNull();
    expect(balance.get("a")).toBe(0);
  });

  it("a discarded call (balance left untouched) doesn't consume the item", () => {
    // The batch-skip scenario: day 1 consumes, day 2 is skipped (we
    // simulate by NOT calling the helper for it), day 3 still sees the
    // full post-day-1 balance — not an over-drawn one.
    const pantry = [item("a", "Eggs", 4, "eggs")];
    const balance = new Map(pantry.map((i) => [i.id, i.quantity] as const));
    planPerFoodConsumptionAgainstBalance(
      [{ name: "Eggs", grams: 100 }],
      pantry,
      balance,
    );
    // Day 2 skipped — no call against `balance`.
    const day3 = planPerFoodConsumptionAgainstBalance(
      [{ name: "Eggs", grams: 100 }],
      pantry,
      balance,
    );
    expect(day3[0]?.consumedQty).toBe(1);
    expect(balance.get("a")).toBe(2);
  });
});

describe("roundQuantity", () => {
  it("trims float drift to 3 decimals and leaves integers alone", () => {
    expect(roundQuantity(0.9600000000000001)).toBe(0.96);
    expect(roundQuantity(80)).toBe(80);
  });
});
