import { describe, expect, it } from "vitest";
import { computeMealInsights } from "./meal-insights";

describe("computeMealInsights", () => {
  it("returns nothing for a calm, balanced meal", () => {
    const out = computeMealInsights({
      calories: 400,
      protein: 30,
      carbs: 40,
      fat: 12,
      fiber: 5,
    });
    expect(out).toEqual([]);
  });

  it("flags a low-fiber sizeable meal", () => {
    const out = computeMealInsights({
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 15,
      fiber: 1,
    });
    expect(out.some((i) => i.title === "Low fiber" && i.tone === "warn")).toBe(
      true,
    );
  });

  it("does not flag low fiber on a small snack", () => {
    const out = computeMealInsights({
      calories: 120,
      protein: 4,
      carbs: 18,
      fat: 3,
      fiber: 1,
    });
    expect(out.some((i) => i.title === "Low fiber")).toBe(false);
  });

  it("does not claim low fiber when most of the meal's fiber is unknown", () => {
    // One known-zero food out of several; the rest carry no fiber data.
    // "Only 0g" would be an unfounded claim, not a finding.
    const out = computeMealInsights({
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 15,
      fiber: 0,
      fiberKnownCalorieShare: 0.3,
    });
    expect(out.some((i) => i.title === "Low fiber")).toBe(false);
  });

  it("still flags low fiber when coverage is high", () => {
    const out = computeMealInsights({
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 15,
      fiber: 1,
      fiberKnownCalorieShare: 0.9,
    });
    expect(out.some((i) => i.title === "Low fiber" && i.tone === "warn")).toBe(
      true,
    );
  });

  it("keeps the good-fiber positive even with partial coverage", () => {
    // A high partial sum only understates the truth — never gate it.
    const out = computeMealInsights({
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 15,
      fiber: 9,
      fiberKnownCalorieShare: 0.3,
    });
    expect(out.some((i) => i.title === "Good fiber" && i.tone === "good")).toBe(
      true,
    );
  });

  it("flags high saturated fat and high added sugar", () => {
    const out = computeMealInsights({
      calories: 600,
      protein: 15,
      carbs: 70,
      fat: 25,
      saturatedFat: 10,
      addedSugars: 20,
    });
    expect(out.some((i) => i.title === "High saturated fat")).toBe(true);
    expect(out.some((i) => i.title === "High added sugar")).toBe(true);
  });

  it("calls out a fat-heavy macro split", () => {
    const out = computeMealInsights({
      calories: 300,
      protein: 5,
      carbs: 5,
      fat: 30, // 270 of ~310 kcal from fat
    });
    expect(out.some((i) => i.title === "Fat-heavy" && i.tone === "warn")).toBe(
      true,
    );
  });

  it("reinforces a protein-forward meal", () => {
    const out = computeMealInsights({
      calories: 300,
      protein: 40,
      carbs: 10,
      fat: 5,
    });
    expect(
      out.some((i) => i.title === "Protein-forward" && i.tone === "good"),
    ).toBe(true);
  });

  it("highlights a great micronutrient source and high sodium", () => {
    const out = computeMealInsights({
      calories: 400,
      protein: 25,
      carbs: 30,
      fat: 12,
      micros: { vitaminC: 80, sodium: 1200 },
      microTargets: { vitaminC: 90, sodium: 2300 },
    });
    expect(out.some((i) => i.title === "Great source of Vitamin C")).toBe(true);
    expect(out.some((i) => i.title === "High sodium")).toBe(true);
  });

  it("flags a meal light on protein for the goal", () => {
    const out = computeMealInsights({
      calories: 600,
      protein: 8,
      carbs: 90,
      fat: 20,
      goal: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    });
    expect(out.some((i) => i.title === "Light on protein for your goal")).toBe(
      true,
    );
  });

  it("flags a meal that's a big share of the day", () => {
    const out = computeMealInsights({
      calories: 1100,
      protein: 60,
      carbs: 110,
      fat: 35,
      goal: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    });
    expect(out.some((i) => i.title === "Big share of your day")).toBe(true);
  });

  it("adds no goal-fit insight without a goal", () => {
    const out = computeMealInsights({
      calories: 600,
      protein: 8,
      carbs: 90,
      fat: 20,
    });
    expect(out.some((i) => i.title === "Light on protein for your goal")).toBe(
      false,
    );
  });

  it("sorts warnings before positives", () => {
    const out = computeMealInsights({
      calories: 500,
      protein: 40,
      carbs: 30,
      fat: 15,
      fiber: 1, // low fiber (warn)
    });
    const warnIdx = out.findIndex((i) => i.tone === "warn");
    const goodIdx = out.findIndex((i) => i.tone === "good");
    if (warnIdx >= 0 && goodIdx >= 0) expect(warnIdx).toBeLessThan(goodIdx);
  });
});
