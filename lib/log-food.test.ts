import { addFoodBasis, scaleFoodToItem } from "@/lib/log-food";
import { describe, expect, it } from "vitest";
import type { Food } from "@maqro/core/types";

/** A per-100g OFF food carrying sub-macros + micros + an off: id, so the
 *  scaling test exercises every channel `scaleFoodToItem` propagates. */
const OFF_FOOD: Food = {
  id: "off:3017620422003",
  source: "off",
  name: "Nutella",
  protein: 6,
  carbs: 57.5,
  fat: 30.9,
  calories: 539,
  saturatedFat: 10.6,
  sugars: 56.3,
  fiber: 0,
  micronutrients: { sodium: 0.04, calcium: 0.1 },
};

describe("scaleFoodToItem", () => {
  it("scales main macros (1dp / integer kcal) and stores raw per-100g originalValues", () => {
    const item = scaleFoodToItem(OFF_FOOD, 25);
    expect(item.portionSize).toBe(25);
    expect(item.protein).toBe(1.5); // 6 * 0.25
    expect(item.carbs).toBe(14.4); // 57.5 * 0.25 = 14.375 → 14.4
    expect(item.fat).toBe(7.7); // 30.9 * 0.25 = 7.725 → 7.7
    expect(item.calories).toBe(135); // 539 * 0.25 = 134.75 → 135
    expect(item.originalValues).toEqual({
      proteinPer100g: 6,
      carbsPer100g: 57.5,
      fatPer100g: 30.9,
      caloriesPer100g: 539,
    });
  });

  it("stores sub-macros PRE-scaled to the portion", () => {
    const item = scaleFoodToItem(OFF_FOOD, 25);
    expect(item.saturatedFat).toBe(2.6); // 10.6 * 0.25 → 2.6 (float toFixed)
    expect(item.sugars).toBe(14.1); // 56.3 * 0.25 = 14.075 → 14.1
    expect(item.fiber).toBe(0);
  });

  it("passes micronutrients through UNSCALED (per-100g) and derives offCode", () => {
    const item = scaleFoodToItem(OFF_FOOD, 25);
    expect(item.micronutrients).toEqual({ sodium: 0.04, calcium: 0.1 });
    expect(item.offCode).toBe("3017620422003");
  });

  it("leaves offCode undefined for non-OFF foods", () => {
    const builtin: Food = {
      id: "builtin:chicken-breast",
      source: "builtin",
      name: "Chicken Breast",
      protein: 31,
      carbs: 0,
      fat: 3.6,
      calories: 165,
    };
    expect(scaleFoodToItem(builtin, 150).offCode).toBeUndefined();
  });
});

describe("addFoodBasis", () => {
  // Build the portion-scaled grid values the form would show for OFF_FOOD at
  // `grams`, using the EXACT rounding handleFoodSelect/handlePortionChange use.
  function gridFor(food: Food, grams: number) {
    const r = grams / 100;
    return {
      protein: Number.parseFloat((food.protein * r).toFixed(1)),
      carbs: Number.parseFloat((food.carbs * r).toFixed(1)),
      fat: Number.parseFloat((food.fat * r).toFixed(1)),
      calories: Math.round(food.calories * r),
    };
  }

  it("returns the picked food VERBATIM (with provenance) when macros are untouched", () => {
    const basis = addFoodBasis(
      OFF_FOOD,
      gridFor(OFF_FOOD, 25),
      OFF_FOOD.name,
      25,
    );
    expect(basis).toEqual({ ...OFF_FOOD, name: OFF_FOOD.name });
    // The whole point: a desktop add of an untouched pick === the mobile add.
    expect(scaleFoodToItem(basis, 25)).toEqual(scaleFoodToItem(OFF_FOOD, 25));
  });

  it("keeps provenance but applies an edited name when only the name changed", () => {
    const basis = addFoodBasis(
      OFF_FOOD,
      gridFor(OFF_FOOD, 25),
      "Choc spread",
      25,
    );
    expect(basis.name).toBe("Choc spread");
    expect(basis.id).toBe("off:3017620422003");
    expect(basis.micronutrients).toEqual({ sodium: 0.04, calcium: 0.1 });
  });

  it("reconstructs per-100g and DROPS provenance on a manual macro override", () => {
    // User bumped protein in the grid; everything else matches the pick.
    const edited = { ...gridFor(OFF_FOOD, 50), protein: 9 };
    const basis = addFoodBasis(OFF_FOOD, edited, OFF_FOOD.name, 50);
    expect(basis.id).toBeUndefined();
    expect(basis.source).toBeUndefined();
    expect(basis.micronutrients).toBeUndefined();
    expect(basis.protein).toBeCloseTo(18, 6); // 9 / (50/100)
    const item = scaleFoodToItem(basis, 50);
    expect(item.protein).toBe(9); // round-trips back to the user's value
    expect(item.offCode).toBeUndefined();
    expect(item.saturatedFat).toBeUndefined(); // sub-macros dropped with the pick
  });

  it("builds a bare per-100g food for a fully-manual entry (no pick)", () => {
    const basis = addFoodBasis(
      null,
      { protein: 10, carbs: 20, fat: 5, calories: 165 },
      "Homemade bar",
      200,
    );
    expect(basis.name).toBe("Homemade bar");
    expect(basis.id).toBeUndefined();
    expect(basis.protein).toBeCloseTo(5, 6); // 10 / (200/100)
    expect(basis.calories).toBeCloseTo(82.5, 6);
  });

  it("does not divide by zero on a zero/blank portion", () => {
    const basis = addFoodBasis(
      null,
      { protein: 4, carbs: 4, fat: 4, calories: 72 },
      "x",
      0,
    );
    expect(basis.protein).toBe(0);
    expect(basis.calories).toBe(0);
  });
});
