import type { Food } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  aiPlanToMeals,
  type AiPlanShape,
  normalizeName,
  unmatchedPickNames,
} from "./plan";

const catalog: Food[] = [
  { name: "Chicken Breast", protein: 31, carbs: 0, fat: 3.6, calories: 165 },
  { name: "Oats", protein: 13, carbs: 67, fat: 7, calories: 389 },
  { name: "Olive Oil", protein: 0, carbs: 0, fat: 100, calories: 884 },
];

describe("aiPlanToMeals", () => {
  it("matches AI picks back to the catalog and computes macros from the catalog", () => {
    const ai: AiPlanShape = {
      meals: [
        { name: "Breakfast", foods: [{ name: "Oats", portionGrams: 100 }] },
        {
          name: "Lunch",
          foods: [{ name: "Chicken Breast", portionGrams: 200 }],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast", "Lunch"], catalog, 1);
    expect(meals).toHaveLength(2);
    expect(meals[0].foods).toHaveLength(1);
    // Macros are computed from catalog × portion ratio, NOT from anything
    // the AI invented.
    expect(meals[0].foods[0].name).toBe("Oats");
    expect(meals[0].foods[0].portionSize).toBe(100);
    expect(meals[0].foods[0].protein).toBe(13);
    expect(meals[1].foods[0].name).toBe("Chicken Breast");
    expect(meals[1].foods[0].portionSize).toBe(200);
    expect(meals[1].foods[0].protein).toBe(62); // 31 × 2
    expect(meals[1].foods[0].calories).toBe(330); // 165 × 2
  });

  it("drops hallucinated foods (name not in catalog)", () => {
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            { name: "Oats", portionGrams: 80 },
            { name: "Unicorn Bacon", portionGrams: 100 }, // not in catalog
          ],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods).toHaveLength(1);
    expect(meals[0].foods[0].name).toBe("Oats");
  });

  it("matches food names case-insensitively and trims whitespace", () => {
    const ai: AiPlanShape = {
      meals: [
        { name: "Breakfast", foods: [{ name: "  oats  ", portionGrams: 50 }] },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods).toHaveLength(1);
    expect(meals[0].foods[0].name).toBe("Oats");
  });

  it("clamps portions to [5, 500] g and snaps to 5g grid", () => {
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            { name: "Oats", portionGrams: 0 }, // → 5
            { name: "Olive Oil", portionGrams: 999 }, // → 500
            { name: "Chicken Breast", portionGrams: 122 }, // → 120 (snap)
          ],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods[0].portionSize).toBe(5);
    expect(meals[0].foods[1].portionSize).toBe(500);
    expect(meals[0].foods[2].portionSize).toBe(120);
  });

  it("matches meal slots by name first, falls back to positional", () => {
    // AI returns meals in a different order — still matched by name.
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Lunch",
          foods: [{ name: "Chicken Breast", portionGrams: 150 }],
        },
        { name: "Breakfast", foods: [{ name: "Oats", portionGrams: 80 }] },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast", "Lunch"], catalog);
    expect(meals[0].name).toBe("Breakfast");
    expect(meals[0].foods[0].name).toBe("Oats");
    expect(meals[1].name).toBe("Lunch");
    expect(meals[1].foods[0].name).toBe("Chicken Breast");
  });

  it("returns empty meals for slots the AI didn't fill", () => {
    const ai: AiPlanShape = {
      meals: [
        { name: "Breakfast", foods: [{ name: "Oats", portionGrams: 50 }] },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast", "Dinner"], catalog);
    expect(meals[1].name).toBe("Dinner");
    expect(meals[1].foods).toHaveLength(0);
  });

  it("mints distinct ids starting from the given startId", () => {
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            { name: "Oats", portionGrams: 50 },
            { name: "Olive Oil", portionGrams: 10 },
          ],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog, 100);
    expect(meals[0].foods[0].id).toBe(100);
    expect(meals[0].foods[1].id).toBe(101);
  });

  // Defensive coverage: the AI is *forced* into submit_meal_plan via
  // tool_choice on the last iteration, but it can still hand us a
  // partial / malformed input. Empty meal slots > a 500 from the route.
  it("tolerates a missing meals array (returns empty slots)", () => {
    const meals = aiPlanToMeals(
      {} as unknown as AiPlanShape,
      ["Breakfast", "Lunch"],
      catalog,
    );
    expect(meals).toHaveLength(2);
    expect(meals[0].foods).toHaveLength(0);
    expect(meals[1].foods).toHaveLength(0);
  });

  it("tolerates a non-array meals value", () => {
    const meals = aiPlanToMeals(
      { meals: null } as unknown as AiPlanShape,
      ["Breakfast"],
      catalog,
    );
    expect(meals[0].foods).toHaveLength(0);
  });

  it("tolerates a meal entry with missing foods array", () => {
    const ai = {
      meals: [{ name: "Breakfast" } as unknown as AiPlanShape["meals"][0]],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods).toHaveLength(0);
  });

  it("tolerates picks with missing or non-numeric portionGrams (clamps to safe minimum)", () => {
    const ai = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            { name: "Oats" } as unknown as AiPlanShape["meals"][0]["foods"][0],
            { name: "Olive Oil", portionGrams: "lots" as unknown as number },
          ],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    // Both foods made it in, with portions clamped from the bad inputs.
    expect(meals[0].foods).toHaveLength(2);
    expect(meals[0].foods[0].portionSize).toBeGreaterThanOrEqual(5);
    expect(meals[0].foods[1].portionSize).toBeGreaterThanOrEqual(5);
  });

  it("tolerates picks with non-string name (silently dropped)", () => {
    const ai = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            {
              name: 42,
              portionGrams: 100,
            } as unknown as AiPlanShape["meals"][0]["foods"][0],
            { name: "Oats", portionGrams: 50 },
          ],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods).toHaveLength(1);
    expect(meals[0].foods[0].name).toBe("Oats");
  });

  // Looser name matching: OFF returns verbose, brand-laden names that
  // wouldn't survive a strict exact match. The normalizer + substring
  // fallback let the model's paraphrases still resolve so the route
  // doesn't 502 on what amounts to a spelling mismatch.
  it("matches a pick against a catalog entry that has brand/qualifier suffixes", () => {
    const verbose: Food[] = [
      {
        name: "Greek Yogurt, Plain — Fage Total 0%",
        protein: 10,
        carbs: 4,
        fat: 0,
        calories: 59,
      },
    ];
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [{ name: "Greek Yogurt", portionGrams: 200 }],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], verbose);
    expect(meals[0].foods).toHaveLength(1);
    expect(meals[0].foods[0].name).toBe("Greek Yogurt, Plain — Fage Total 0%");
  });

  it("matches a verbose pick name against a short catalog entry", () => {
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [{ name: "Rolled oats (steel-cut)", portionGrams: 80 }],
        },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], catalog);
    expect(meals[0].foods).toHaveLength(1);
    expect(meals[0].foods[0].name).toBe("Oats");
  });

  it("does NOT match short ambiguous names below the substring threshold", () => {
    // "egg" (3 chars) is too short to be safely matched as a substring of
    // "egg salad" — we'd be making up macros for a different dish.
    const eggSaladCatalog: Food[] = [
      { name: "Egg salad", protein: 12, carbs: 1, fat: 18, calories: 200 },
    ];
    const ai: AiPlanShape = {
      meals: [
        { name: "Breakfast", foods: [{ name: "egg", portionGrams: 50 }] },
      ],
    };
    const meals = aiPlanToMeals(ai, ["Breakfast"], eggSaladCatalog);
    expect(meals[0].foods).toHaveLength(0);
  });
});

describe("normalizeName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeName("  Greek  Yogurt  ")).toBe("greek yogurt");
  });

  it("drops parenthetical content", () => {
    expect(normalizeName("Yogurt (Fage)")).toBe("yogurt");
  });

  it("drops content after a comma, dash, or em-dash", () => {
    expect(normalizeName("Yogurt, Plain")).toBe("yogurt");
    expect(normalizeName("Yogurt - Plain")).toBe("yogurt");
    expect(normalizeName("Yogurt — Plain")).toBe("yogurt");
  });

  it("strips accents", () => {
    expect(normalizeName("Crème Brûlée")).toBe("creme brulee");
  });

  it("strips non-alphanumeric punctuation", () => {
    expect(normalizeName("Chicken & Rice!")).toBe("chicken rice");
  });
});

describe("unmatchedPickNames", () => {
  it("returns the pick names that don't resolve against the catalog", () => {
    const ai: AiPlanShape = {
      meals: [
        {
          name: "Breakfast",
          foods: [
            { name: "Oats", portionGrams: 50 }, // matches
            { name: "Unicorn Bacon", portionGrams: 100 }, // doesn't
            { name: "Phoenix Egg", portionGrams: 60 }, // doesn't
          ],
        },
      ],
    };
    expect(unmatchedPickNames(ai, catalog)).toEqual([
      "Unicorn Bacon",
      "Phoenix Egg",
    ]);
  });

  it("returns an empty array when every pick resolves", () => {
    const ai: AiPlanShape = {
      meals: [
        { name: "Breakfast", foods: [{ name: "Oats", portionGrams: 50 }] },
      ],
    };
    expect(unmatchedPickNames(ai, catalog)).toEqual([]);
  });

  it("returns an empty array for a malformed plan", () => {
    expect(unmatchedPickNames({} as unknown as AiPlanShape, catalog)).toEqual(
      [],
    );
  });
});
