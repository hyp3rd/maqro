import type { FoodItem, Meal } from "@/components/macro/types";
import type { PantryItem } from "@/lib/db";
import { describe, expect, it } from "vitest";
import { replanPantryDeltas } from "./replan";

function food(
  id: number,
  name: string,
  portionSize = 100,
  pantrySource?: { itemId: string; consumedQty: number },
): FoodItem {
  return {
    id,
    name,
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    portionSize,
    pantrySource,
  };
}

function meal(id: number, name: string, foods: FoodItem[]): Meal {
  return { id, name, foods };
}

function item(
  id: string,
  name: string,
  quantity: number,
  unit = "x",
): PantryItem {
  return { id, name, quantity, unit, createdAt: 0, updatedAt: 0 };
}

describe("replanPantryDeltas", () => {
  it("draws new foods and stamps them when there's no prior plan", () => {
    const pantry = [item("a", "Eggs", 4, "eggs")];
    const newMeals = [meal(1, "Breakfast", [food(1, "Eggs")])];
    const net = replanPantryDeltas([], newMeals, pantry);
    expect(net.get("a")).toBe(1);
    expect(newMeals[0]?.foods[0]?.pantrySource).toEqual({
      itemId: "a",
      consumedQty: 1,
    });
  });

  it("restores old stamps when the new plan matches none of them", () => {
    // Old breakfast drew 1 egg. New plan replaces breakfast with toast
    // (no pantry match). Net should restore the egg.
    const pantry = [item("a", "Eggs", 3, "eggs")];
    const oldMeals = [
      meal(1, "Breakfast", [
        food(1, "Eggs", 100, { itemId: "a", consumedQty: 1 }),
      ]),
    ];
    const newMeals = [meal(1, "Breakfast", [food(2, "Toast")])];
    const net = replanPantryDeltas(oldMeals, newMeals, pantry);
    expect(net.get("a")).toBe(-1);
    // The toast food was unmatched — no stamp.
    expect(newMeals[0]?.foods[0]?.pantrySource).toBeUndefined();
  });

  it("nets restore + draw on the same item (collapses to delta)", () => {
    // Old: 1 egg drawn. New: 2 eggs drawn. Net = +1 (give back 1, take 2).
    const pantry = [item("a", "Eggs", 5, "eggs")];
    const oldMeals = [
      meal(1, "B", [food(1, "Eggs", 100, { itemId: "a", consumedQty: 1 })]),
    ];
    const newMeals = [meal(1, "B", [food(2, "Eggs"), food(3, "Eggs")])];
    const net = replanPantryDeltas(oldMeals, newMeals, pantry);
    expect(net.get("a")).toBe(1);
  });

  it("drops items that net to zero (no pointless writes)", () => {
    // Old drew 1 egg, new draws 1 egg — net delta is 0; no pantry write.
    const pantry = [item("a", "Eggs", 3, "eggs")];
    const oldMeals = [
      meal(1, "B", [food(1, "Eggs", 100, { itemId: "a", consumedQty: 1 })]),
    ];
    const newMeals = [meal(1, "B", [food(2, "Eggs")])];
    const net = replanPantryDeltas(oldMeals, newMeals, pantry);
    expect(net.has("a")).toBe(false);
    // Stamp still lands on the new food so future edits can restore it.
    expect(newMeals[0]?.foods[0]?.pantrySource).toEqual({
      itemId: "a",
      consumedQty: 1,
    });
  });

  it("caps the new draw against pantry-plus-restored, not raw pantry", () => {
    // Pantry has 1 egg LEFT (one drawn by the old plan). New plan asks
    // for 2 eggs. Without crediting the restore, only 1 could be drawn;
    // with it, both eggs are drawable (the restored one frees the cap).
    const pantry = [item("a", "Eggs", 1, "eggs")];
    const oldMeals = [
      meal(1, "B", [food(1, "Eggs", 100, { itemId: "a", consumedQty: 1 })]),
    ];
    const newMeals = [meal(1, "B", [food(2, "Eggs"), food(3, "Eggs")])];
    const net = replanPantryDeltas(oldMeals, newMeals, pantry);
    expect(net.get("a")).toBe(1);
    expect(newMeals[0]?.foods[0]?.pantrySource?.consumedQty).toBe(1);
    expect(newMeals[0]?.foods[1]?.pantrySource?.consumedQty).toBe(1);
  });
});
