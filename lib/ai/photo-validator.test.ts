import { describe, expect, it } from "vitest";
import { type EstimatedItem, validatePhotoMacros } from "./photo-validator";

function item(
  name: string,
  macros: Partial<EstimatedItem["macros"]> = {},
  portionGrams = 100,
): EstimatedItem {
  return {
    name,
    portionGrams,
    macros: { protein: 0, carbs: 0, fat: 0, calories: 0, ...macros },
  };
}

describe("validatePhotoMacros", () => {
  it("returns no issues for a plausible chicken-breast estimate", () => {
    const issues = validatePhotoMacros([
      item("Grilled chicken breast", {
        protein: 31,
        carbs: 0,
        fat: 3.6,
        calories: 165,
      }),
    ]);
    expect(issues).toEqual([]);
  });

  it("returns no issues for an empty list", () => {
    expect(validatePhotoMacros([])).toEqual([]);
  });

  it("flags macros that sum above 105g per 100g (physically impossible)", () => {
    const issues = validatePhotoMacros([
      item("Mystery food", { protein: 50, carbs: 50, fat: 30, calories: 700 }),
    ]);
    const issue = issues.find((i) => i.code === "macro-sum-too-high");
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/Mystery food/);
  });

  it("flags kcal that doesn't match 4P + 4C + 9F within ±30%", () => {
    // 4*10 + 4*20 + 9*5 = 165 kcal — claiming 400 is way off.
    const issues = validatePhotoMacros([
      item("Pasta dish", { protein: 10, carbs: 20, fat: 5, calories: 400 }),
    ]);
    const issue = issues.find((i) => i.code === "kcal-macro-mismatch");
    expect(issue).toBeDefined();
  });

  it("does NOT flag kcal mismatch when calories is 0 (plain water/tea)", () => {
    const issues = validatePhotoMacros([
      item("Black coffee", { protein: 0, carbs: 0, fat: 0, calories: 0 }),
    ]);
    expect(
      issues.find((i) => i.code === "kcal-macro-mismatch"),
    ).toBeUndefined();
  });

  it("accepts a small kcal vs macro deviation (within ±30%)", () => {
    // 4*5 + 4*60 + 9*1 = 269 — claim 300 (12% over, ok).
    const issues = validatePhotoMacros([
      item("Cooked rice", { protein: 5, carbs: 60, fat: 1, calories: 300 }),
    ]);
    expect(
      issues.find((i) => i.code === "kcal-macro-mismatch"),
    ).toBeUndefined();
  });

  it("flags pure-fat foods (olive oil) when macros don't match the category", () => {
    const issues = validatePhotoMacros([
      item("Olive Oil", { protein: 15, carbs: 10, fat: 60, calories: 700 }),
    ]);
    const issue = issues.find((i) => i.code === "category-impossible");
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/Olive Oil/);
  });

  it("accepts olive oil when macros look right (~100g fat, ~0 other)", () => {
    const issues = validatePhotoMacros([
      item("Olive Oil", { protein: 0, carbs: 0, fat: 100, calories: 884 }),
    ]);
    expect(
      issues.find((i) => i.code === "category-impossible"),
    ).toBeUndefined();
  });

  it("flags implausibly large oil portions (> 50g)", () => {
    const issues = validatePhotoMacros([
      item("Olive Oil", { protein: 0, carbs: 0, fat: 100, calories: 884 }, 80),
    ]);
    const issue = issues.find((i) => i.code === "oil-portion-too-large");
    expect(issue).toBeDefined();
  });

  it("accepts a small drizzle of oil (15g)", () => {
    const issues = validatePhotoMacros([
      item("Olive Oil", { protein: 0, carbs: 0, fat: 100, calories: 884 }, 15),
    ]);
    expect(
      issues.find((i) => i.code === "oil-portion-too-large"),
    ).toBeUndefined();
  });

  it("flags meat/fish with implausibly low protein", () => {
    const issues = validatePhotoMacros([
      item("Grilled salmon", { protein: 3, carbs: 1, fat: 14, calories: 150 }),
    ]);
    const issue = issues.find((i) => i.code === "fat-claimed-as-protein");
    expect(issue).toBeDefined();
  });

  it("returns one issue per affected item across a mixed list", () => {
    const issues = validatePhotoMacros([
      item("Chicken Breast", { protein: 31, carbs: 0, fat: 4, calories: 165 }), // OK
      item("Olive Oil", { protein: 20, carbs: 10, fat: 50, calories: 600 }), // category-impossible
      item("Pasta", { protein: 7, carbs: 70, fat: 1, calories: 1000 }), // kcal-macro-mismatch
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.code === "category-impossible")).toBe(true);
    expect(issues.some((i) => i.code === "kcal-macro-mismatch")).toBe(true);
  });
});
