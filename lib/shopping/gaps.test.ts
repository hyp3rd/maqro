import type { PantryItem } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { pantryGapItems } from "./gaps";

function item(
  id: string,
  name: string,
  quantity: number,
  unit = "unit",
): PantryItem {
  return { id, name, quantity, unit, createdAt: 0, updatedAt: 0 };
}

describe("pantryGapItems", () => {
  it("includes anything empty regardless of unit", () => {
    const gaps = pantryGapItems([
      item("a", "Rice", 0, "kg"),
      item("b", "Eggs", 0, "eggs"),
      item("c", "Flour", 0.5, "kg"),
    ]);
    expect(gaps.map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("includes count items at or below the low threshold", () => {
    const gaps = pantryGapItems([
      item("a", "Eggs", 1, "eggs"), // at threshold → low
      item("b", "Cans", 2, "can"), // above → fine
    ]);
    expect(gaps.map((g) => g.id)).toEqual(["a"]);
  });

  it("does not flag a partly-full mass item as low", () => {
    // 0.5 kg of flour is not 'low' — only empty mass items qualify.
    expect(pantryGapItems([item("a", "Flour", 0.5, "kg")])).toEqual([]);
    expect(pantryGapItems([item("b", "Oats", 200, "g")])).toEqual([]);
  });

  it("treats free-text units as count units", () => {
    const gaps = pantryGapItems([
      item("a", "Olive Oil", 1, "bottle"),
      item("b", "Pasta", 3, "bag"),
    ]);
    expect(gaps.map((g) => g.id)).toEqual(["a"]);
  });

  it("returns empty when everything is well-stocked", () => {
    expect(
      pantryGapItems([
        item("a", "Rice", 2, "kg"),
        item("b", "Eggs", 12, "eggs"),
      ]),
    ).toEqual([]);
  });
});
