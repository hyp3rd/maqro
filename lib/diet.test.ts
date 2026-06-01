import type { Food, Recipe } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  classifyFood,
  filterByDiet,
  isCompatibleWithDiet,
  recipeDietCompatibility,
} from "./diet";

function makeRecipe(
  ingredients: Array<{ dietKind?: Recipe["ingredients"][0]["dietKind"] }>,
): Recipe {
  return {
    id: "r1",
    name: "Test",
    ingredients: ingredients.map((ing, i) => ({
      foodName: `food-${i}`,
      macrosPer100g: { protein: 1, carbs: 1, fat: 1, calories: 9 },
      portionGrams: 100,
      dietKind: ing.dietKind,
    })),
    createdAt: 0,
    updatedAt: 0,
  };
}

const chicken: Food = {
  name: "Chicken Breast",
  protein: 31,
  carbs: 0,
  fat: 3.6,
  calories: 165,
  category: "lean protein",
  subCategory: "poultry",
};
const salmon: Food = {
  name: "Salmon",
  protein: 20,
  carbs: 0,
  fat: 13,
  calories: 208,
  category: "fatty protein",
  subCategory: "fish",
};
const egg: Food = {
  name: "Egg",
  protein: 13,
  carbs: 1,
  fat: 11,
  calories: 155,
  category: "lean protein",
  subCategory: "egg",
};
const yogurt: Food = {
  name: "Greek Yogurt",
  protein: 10,
  carbs: 3.6,
  fat: 0.4,
  calories: 59,
  category: "dairy",
  subCategory: "yogurt",
};
const oats: Food = {
  name: "Oats",
  protein: 13,
  carbs: 67,
  fat: 7,
  calories: 389,
  category: "grain",
  subCategory: "oats",
};
const olive: Food = {
  name: "Olive Oil",
  protein: 0,
  carbs: 0,
  fat: 100,
  calories: 884,
  category: "oil",
  subCategory: "olive oil",
};
const honey: Food = {
  name: "Honey",
  protein: 0,
  carbs: 82,
  fat: 0,
  calories: 304,
  category: "sweetener",
  subCategory: "honey",
};
const wheyBar: Food = {
  name: "Whey Protein Bar",
  protein: 20,
  carbs: 22,
  fat: 6,
  calories: 220,
  category: "supplement",
  subCategory: "protein bar",
};
const customNoTags: Food = {
  // Custom-food / OFF shape — no category/subCategory.
  name: "Mystery Food",
  protein: 10,
  carbs: 20,
  fat: 5,
  calories: 165,
};

describe("classifyFood", () => {
  it("classifies land meat by subCategory", () => {
    expect(classifyFood(chicken)).toBe("land-meat");
  });
  it("classifies seafood by subCategory", () => {
    expect(classifyFood(salmon)).toBe("seafood");
  });
  it("classifies eggs", () => {
    expect(classifyFood(egg)).toBe("egg");
  });
  it("classifies dairy by category", () => {
    expect(classifyFood(yogurt)).toBe("dairy");
  });
  it("classifies honey separately from other sweeteners", () => {
    expect(classifyFood(honey)).toBe("honey");
  });
  it("classifies plant categories as plant", () => {
    expect(classifyFood(oats)).toBe("plant");
    expect(classifyFood(olive)).toBe("plant");
  });
  it("defaults whey-style supplements to dairy (vegan-excluded)", () => {
    expect(classifyFood(wheyBar)).toBe("dairy");
  });
  it("returns 'unknown' for foods without tags", () => {
    expect(classifyFood(customNoTags)).toBe("unknown");
  });
});

describe("isCompatibleWithDiet", () => {
  it("omnivore accepts everything", () => {
    for (const f of [chicken, salmon, egg, yogurt, oats, honey]) {
      expect(isCompatibleWithDiet(f, "omnivore")).toBe(true);
    }
  });

  it("pescatarian rejects land meat, accepts seafood/dairy/egg/plant", () => {
    expect(isCompatibleWithDiet(chicken, "pescatarian")).toBe(false);
    expect(isCompatibleWithDiet(salmon, "pescatarian")).toBe(true);
    expect(isCompatibleWithDiet(egg, "pescatarian")).toBe(true);
    expect(isCompatibleWithDiet(yogurt, "pescatarian")).toBe(true);
    expect(isCompatibleWithDiet(oats, "pescatarian")).toBe(true);
  });

  it("vegetarian rejects land meat and seafood", () => {
    expect(isCompatibleWithDiet(chicken, "vegetarian")).toBe(false);
    expect(isCompatibleWithDiet(salmon, "vegetarian")).toBe(false);
    expect(isCompatibleWithDiet(egg, "vegetarian")).toBe(true);
    expect(isCompatibleWithDiet(yogurt, "vegetarian")).toBe(true);
  });

  it("vegan rejects all animal-derived foods including honey", () => {
    expect(isCompatibleWithDiet(chicken, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(salmon, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(egg, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(yogurt, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(honey, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(wheyBar, "vegan")).toBe(false);
    expect(isCompatibleWithDiet(oats, "vegan")).toBe(true);
    expect(isCompatibleWithDiet(olive, "vegan")).toBe(true);
  });

  it("carnivore rejects plant-only foods, accepts animal-derived", () => {
    expect(isCompatibleWithDiet(chicken, "carnivore")).toBe(true);
    expect(isCompatibleWithDiet(salmon, "carnivore")).toBe(true);
    expect(isCompatibleWithDiet(yogurt, "carnivore")).toBe(true);
    expect(isCompatibleWithDiet(oats, "carnivore")).toBe(false);
    expect(isCompatibleWithDiet(olive, "carnivore")).toBe(false);
  });

  it("unknown (custom/OFF) foods are omnivore-only — restricted diets must opt in via explicit dietKind", () => {
    expect(isCompatibleWithDiet(customNoTags, "omnivore")).toBe(true);
    for (const d of [
      "pescatarian",
      "vegetarian",
      "vegan",
      "carnivore",
    ] as const) {
      expect(isCompatibleWithDiet(customNoTags, d)).toBe(false);
    }
  });

  it("explicit dietKind on a custom food overrides absent category tags", () => {
    const tofu = { ...customNoTags, name: "Tofu", dietKind: "plant" as const };
    expect(isCompatibleWithDiet(tofu, "vegan")).toBe(true);
    expect(isCompatibleWithDiet(tofu, "carnivore")).toBe(false);

    const wildSalmon = {
      ...customNoTags,
      name: "Wild Salmon",
      dietKind: "seafood" as const,
    };
    expect(isCompatibleWithDiet(wildSalmon, "pescatarian")).toBe(true);
    expect(isCompatibleWithDiet(wildSalmon, "vegetarian")).toBe(false);
  });
});

describe("filterByDiet", () => {
  it("returns only compatible foods", () => {
    const all = [chicken, salmon, egg, yogurt, oats, olive];
    expect(filterByDiet(all, "vegan").map((f) => f.name)).toEqual([
      "Oats",
      "Olive Oil",
    ]);
    expect(filterByDiet(all, "carnivore").map((f) => f.name)).toEqual([
      "Chicken Breast",
      "Salmon",
      "Egg",
      "Greek Yogurt",
    ]);
  });
});

describe("recipeDietCompatibility", () => {
  it("plant-only recipe is suitable for every diet except carnivore", () => {
    const r = makeRecipe([{ dietKind: "plant" }, { dietKind: "plant" }]);
    const compat = recipeDietCompatibility(r);
    expect(compat.has("omnivore")).toBe(true);
    expect(compat.has("vegetarian")).toBe(true);
    expect(compat.has("vegan")).toBe(true);
    expect(compat.has("pescatarian")).toBe(true);
    expect(compat.has("carnivore")).toBe(false);
  });

  it("dairy ingredient blocks vegan but keeps vegetarian / pescatarian", () => {
    const r = makeRecipe([{ dietKind: "plant" }, { dietKind: "dairy" }]);
    const compat = recipeDietCompatibility(r);
    expect(compat.has("vegan")).toBe(false);
    expect(compat.has("vegetarian")).toBe(true);
    expect(compat.has("pescatarian")).toBe(true);
    expect(compat.has("omnivore")).toBe(true);
    expect(compat.has("carnivore")).toBe(false);
  });

  it("seafood ingredient blocks vegetarian + vegan but keeps pescatarian", () => {
    const r = makeRecipe([{ dietKind: "seafood" }, { dietKind: "plant" }]);
    const compat = recipeDietCompatibility(r);
    expect(compat.has("vegan")).toBe(false);
    expect(compat.has("vegetarian")).toBe(false);
    expect(compat.has("pescatarian")).toBe(true);
    expect(compat.has("omnivore")).toBe(true);
  });

  it("land-meat ingredient leaves only omnivore + carnivore", () => {
    const r = makeRecipe([{ dietKind: "land-meat" }]);
    const compat = recipeDietCompatibility(r);
    expect([...compat].sort()).toEqual(["carnivore", "omnivore"]);
  });

  it("any unknown ingredient drops everything except omnivore", () => {
    const r = makeRecipe([{ dietKind: "plant" }, { dietKind: undefined }]);
    const compat = recipeDietCompatibility(r);
    expect([...compat]).toEqual(["omnivore"]);
  });

  it("returns the full diet set for an empty-ingredient recipe (draft)", () => {
    const r = makeRecipe([]);
    expect(recipeDietCompatibility(r).size).toBe(5);
  });
});
