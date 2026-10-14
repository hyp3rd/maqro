import {
  AI_MAX_BIAS_ITEMS,
  AI_MAX_CUSTOM_FOODS,
  AI_MAX_LABEL_CHARS,
  AI_MAX_NAME_CHARS,
  AI_MAX_UNIT_CHARS,
} from "@/lib/ai/request-limits";
import { describe, expect, it } from "vitest";
import {
  type AiCustomFood,
  clampAiFoodLabels,
  clampAiText,
  toAiCustomFoods,
  toAiPantryBias,
  toAiPreferenceTags,
  toAiRecentlyEaten,
} from "./request-payload";

const s = (n: number) => "x".repeat(n);

const custom = (name: string, extra: Partial<AiCustomFood> = {}) => ({
  id: "c1",
  createdAt: 1,
  name,
  protein: 10,
  carbs: 20,
  fat: 5,
  calories: 165,
  ...extra,
});

describe("clampAiText", () => {
  it("returns text within the limit unchanged", () => {
    expect(clampAiText("Chicken", 7)).toBe("Chicken");
  });

  it("cuts text over the limit to exactly the limit", () => {
    expect(clampAiText(s(250), AI_MAX_NAME_CHARS)).toHaveLength(
      AI_MAX_NAME_CHARS,
    );
  });

  it("backs off rather than splitting a surrogate pair", () => {
    // "🍎" is two UTF-16 units; a cut at 4 would leave a lone surrogate.
    const clamped = clampAiText("abc🍎def", 4);
    expect(clamped).toBe("abc");
    expect(clampAiText("ab🍎def", 4)).toBe("ab🍎");
  });
});

describe("clampAiFoodLabels", () => {
  it("clamps name and category and keeps every other field", () => {
    const food = {
      ...custom(s(250), { category: s(150), brand: s(300) }),
      originalValues: { proteinPer100g: 10 },
    };
    const out = clampAiFoodLabels(food);
    expect(out.name).toHaveLength(AI_MAX_NAME_CHARS);
    expect(out.category).toHaveLength(AI_MAX_LABEL_CHARS);
    expect(out.brand).toBe(food.brand);
    expect(out.originalValues).toEqual({ proteinPer100g: 10 });
  });

  it("passes a null or missing category through", () => {
    expect(clampAiFoodLabels({ name: "Tofu", category: null }).category).toBe(
      null,
    );
    expect(clampAiFoodLabels({ name: "Tofu" })).toEqual({ name: "Tofu" });
  });
});

describe("toAiCustomFoods", () => {
  it("keeps the newest foods up to the route's limit, with clamped labels and only the read fields", () => {
    const library = Array.from({ length: AI_MAX_CUSTOM_FOODS + 3 }, (_, i) =>
      custom(i === 0 ? s(250) : `Food ${i}`, { dietKind: "plant" }),
    );
    const out = toAiCustomFoods(library);
    expect(out).toHaveLength(AI_MAX_CUSTOM_FOODS);
    expect(out[0]?.name).toHaveLength(AI_MAX_NAME_CHARS);
    expect(out[1]).toEqual({
      name: "Food 1",
      protein: 10,
      carbs: 20,
      fat: 5,
      calories: 165,
      category: undefined,
      subCategory: undefined,
      brand: undefined,
      dietKind: "plant",
    });
    expect(out[1]).not.toHaveProperty("id");
  });
});

describe("toAiPreferenceTags", () => {
  it("clamps each tag but never drops one (allergies must all reach the filter)", () => {
    const tags = Array.from({ length: 150 }, (_, i) => `${s(120)}${i}`);
    const out = toAiPreferenceTags(tags);
    expect(out).toHaveLength(150);
    expect(out.every((t) => t.length === AI_MAX_LABEL_CHARS)).toBe(true);
    // A clamped tag is a prefix of the original, so it filters at least
    // as much as the original would.
    expect(tags[0]?.startsWith(out[0] ?? "-")).toBe(true);
  });
});

describe("soft-bias lists", () => {
  it("clamps recently-eaten names and the list length", () => {
    const out = toAiRecentlyEaten(
      Array.from({ length: AI_MAX_BIAS_ITEMS + 1 }, () => ({
        name: s(250),
        count: 2,
      })),
    );
    expect(out).toHaveLength(AI_MAX_BIAS_ITEMS);
    expect(out[0]).toEqual({ name: s(AI_MAX_NAME_CHARS), count: 2 });
  });

  it("clamps pantry names, units and the list length", () => {
    const out = toAiPantryBias(
      Array.from({ length: AI_MAX_BIAS_ITEMS + 1 }, () => ({
        name: s(250),
        quantity: 3,
        unit: s(60),
      })),
    );
    expect(out).toHaveLength(AI_MAX_BIAS_ITEMS);
    expect(out[0]).toEqual({
      name: s(AI_MAX_NAME_CHARS),
      quantity: 3,
      unit: s(AI_MAX_UNIT_CHARS),
    });
  });
});
