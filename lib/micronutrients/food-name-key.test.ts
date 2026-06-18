import type { FoodItem, Meal } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { aggregateMicronutrients, foodNameKey } from "./aggregate";
import type { MicronutrientProfile } from "./types";

// Build the accented name explicitly via code points: typing two accented
// literals would collapse to identical strings, and escape sequences inside
// string literals trip the spell-checker. U+00E8 = the composed grave-e (one
// codepoint); U+0300 = the combining grave accent, so "e" + U+0300 is the
// decomposed form of the same letter.
const GRAVE_E = String.fromCodePoint(0x00e8);
const COMBINING_GRAVE = String.fromCodePoint(0x0300);
const ACUTE_E = String.fromCodePoint(0x00e9);
const COMPOSED = `Cr${GRAVE_E}me`; // composed
const DECOMPOSED = `Cre${COMBINING_GRAVE}me`; // decomposed — same visual name

describe("foodNameKey", () => {
  it("lowercases and trims", () => {
    expect(foodNameKey("  SPINACH ")).toBe("spinach");
  });

  it("collapses NFC and NFD encodings of the same name to one key", () => {
    expect(COMPOSED).not.toBe(DECOMPOSED); // different byte strings...
    expect(foodNameKey(COMPOSED)).toBe(foodNameKey(DECOMPOSED)); // ...one key
  });

  it("keeps accents meaningful (an accented name is NOT its plain form)", () => {
    expect(foodNameKey(`Caf${ACUTE_E}`)).not.toBe(foodNameKey("Cafe"));
  });

  it("joins a logged food to its profile across encoding forms", () => {
    // Food logged with the decomposed name; profile keyed from the composed
    // form — NFC normalization must still join them.
    const f: FoodItem = {
      id: 1,
      name: DECOMPOSED,
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
      portionSize: 100,
    };
    const meal: Meal = { id: 1, name: "Meal", foods: [f] };
    const prof: MicronutrientProfile = {
      nameKey: foodNameKey(COMPOSED),
      source: "search",
      valuesPer100g: { calcium: 110 },
      enrichedAt: 0,
    };
    const out = aggregateMicronutrients(
      [meal],
      new Map([[prof.nameKey, prof]]),
    );
    expect(out.calcium).toBeCloseTo(110);
  });
});
