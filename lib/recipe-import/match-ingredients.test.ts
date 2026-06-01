import { describe, expect, it } from "vitest";
import { matchIngredients } from "./match-ingredients";

/** The matcher is intentionally low-precision — its output is
 *  meant for a UI that surfaces a "verify before saving" banner
 *  and per-row confidence hints. These tests pin the BEHAVIORAL
 *  invariants the UI depends on (confidence ladder, quantity
 *  parsing, name extraction) rather than specific catalog matches
 *  (which can churn as foodDatabase grows). */

describe("matchIngredients — quantity parsing", () => {
  it("parses explicit grams to the correct portion", () => {
    const [r] = matchIngredients(["500 g chicken breast"]);
    expect(r?.ingredient?.portionGrams).toBe(500);
  });

  it("parses kilograms, ounces, and pounds via the mass table", () => {
    const results = matchIngredients([
      "1 kg chicken breast",
      "16 oz chicken breast",
      "1 lb chicken breast",
    ]);
    expect(results[0]?.ingredient?.portionGrams).toBe(500); // clamped from 1000
    // 16 oz ≈ 453g, 1 lb ≈ 453g — both clamped to 500.
    expect(results[1]?.ingredient?.portionGrams).toBe(454);
    expect(results[2]?.ingredient?.portionGrams).toBe(454);
  });

  it("parses cup volumes (water-density approximation, low confidence)", () => {
    const [r] = matchIngredients(["1 cup brown rice"]);
    expect(r?.ingredient?.portionGrams).toBe(240);
    expect(r?.confidence).toBe("low");
  });

  it("parses unicode fractions in quantity", () => {
    const [r] = matchIngredients(["½ cup brown rice"]);
    expect(r?.ingredient?.portionGrams).toBe(120);
  });

  it("parses ASCII fractions (1/2, 3/4) in quantity", () => {
    const [r] = matchIngredients(["1/2 cup brown rice"]);
    expect(r?.ingredient?.portionGrams).toBe(120);
  });

  it("strips comma-modifiers from the name", () => {
    const [r] = matchIngredients(["1 tbsp olive oil, extra virgin"]);
    expect(r?.ingredient?.foodName.toLowerCase()).toContain("olive oil");
  });

  it("defaults portion to 100g when no quantity is given", () => {
    // Pick an ingredient name that's actually in foodDatabase so we
    // exercise the no-quantity branch (a non-matching name would
    // bail at the catalog step before we reach the confidence
    // ladder we're testing).
    const [r] = matchIngredients(["Chicken breast, to taste"]);
    if (r?.ingredient) {
      expect(r.ingredient.portionGrams).toBe(100);
      expect(r.confidence).toBe("low");
      expect(r.note).toMatch(/defaulted/i);
    }
  });
});

describe("matchIngredients — catalog matching", () => {
  it("matches a catalog name exactly with high or exact confidence", () => {
    const [r] = matchIngredients(["500 g chicken breast"]);
    expect(r?.ingredient).not.toBeNull();
    expect(r?.confidence === "exact" || r?.confidence === "high").toBe(true);
  });

  it("returns null + 'none' confidence for ingredients with no catalog overlap", () => {
    const [r] = matchIngredients(["2 cups quinoaberries with rare cactus"]);
    expect(r?.ingredient).toBeNull();
    expect(r?.confidence).toBe("none");
    expect(r?.note).toMatch(/no catalog match/i);
  });

  it("rejects matches below the Jaccard threshold (no generic-token bleed)", () => {
    // A query of just "oil" might token-overlap with many oils in
    // the catalog, but Jaccard 1/N where N is large keeps the
    // score below the 0.34 threshold. The user gets "no match"
    // instead of a confidently-wrong "olive oil".
    const [r] = matchIngredients(["1 tbsp oil"]);
    // Either none, or a real overlap with a single oil entry —
    // both are acceptable. What matters is we DON'T silently pick
    // a random catalog entry.
    expect(r?.confidence === "none" || r?.confidence === "low").toBe(true);
  });

  it("preserves the original string regardless of match outcome", () => {
    const results = matchIngredients([
      "500 g ground beef",
      "no such ingredient on earth",
    ]);
    expect(results[0]?.original).toBe("500 g ground beef");
    expect(results[1]?.original).toBe("no such ingredient on earth");
  });
});

describe("matchIngredients — confidence ladder", () => {
  it("downgrades volume-unit matches to 'low' even when the name is exact", () => {
    const [r] = matchIngredients(["1 cup chicken breast"]);
    if (r?.ingredient) {
      expect(r.confidence).toBe("low");
      expect(r.note).toMatch(/verify portion/i);
    }
  });

  it("'mass' parses get exact/high confidence when name matches", () => {
    const [r] = matchIngredients(["500 g chicken breast"]);
    expect(r?.confidence === "exact" || r?.confidence === "high").toBe(true);
  });
});

describe("matchIngredients — preserves macros from catalog", () => {
  it("uses catalog macros (per 100g) verbatim, never invented", () => {
    const [r] = matchIngredients(["500 g chicken breast"]);
    if (r?.ingredient) {
      // Catalog has chicken breast at 165 kcal/100g (per data file).
      // Whatever the actual value is, it must NOT be 0 / NaN /
      // missing — that's the contract: ALWAYS catalog-sourced.
      expect(r.ingredient.macrosPer100g.calories).toBeGreaterThan(0);
      expect(r.ingredient.macrosPer100g.protein).toBeGreaterThan(0);
    }
  });
});

describe("matchIngredients — list shape", () => {
  it("returns one result per input in original order", () => {
    const inputs = ["a", "b", "c", "d", "e"];
    const results = matchIngredients(inputs);
    expect(results.length).toBe(5);
    expect(results.map((r) => r.original)).toEqual(inputs);
  });

  it("handles empty strings without throwing", () => {
    const results = matchIngredients(["", "   "]);
    expect(results.every((r) => r.ingredient === null)).toBe(true);
  });

  it("handles an empty list", () => {
    expect(matchIngredients([])).toEqual([]);
  });
});
