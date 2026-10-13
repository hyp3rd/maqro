import { REFINERS } from "@/lib/ai/refiners";
import {
  AI_MAX_IMAGE_BYTES,
  AI_MAX_JSON_BODY_BYTES,
} from "@/lib/ai/request-limits";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MICRONUTRIENT_KEYS } from "@maqro/core/rda";
import { CUISINES } from "@maqro/core/types";
import { POST as identifyMeal } from "./identify-meal/route";
import { POST as identifyPantry } from "./identify-pantry/route";
import { POST as mealInsights } from "./meal-insights/route";
import { POST as mealPlan } from "./meal-plan/route";
import { POST as recipesGenerate } from "./recipes/generate/route";
import { POST as importFromUrl } from "./recipes/import-from-url/route";
import { POST as shoppingSuggest } from "./shopping/suggest/route";
import { POST as suggestDay } from "./suggest-day/route";
import { POST as voiceLog } from "./voice-log/route";

/** Request-size limits on every AI route (lib/ai/request-limits.ts).
 *
 *  The monthly AI quota counts requests, not tokens, so each route must
 *  refuse an oversized prompt input BEFORE the model is called, and
 *  before the quota is debited so a rejected request costs no credit.
 *  Every rejection case asserts neither the Anthropic SDK nor the meter
 *  was reached; the acceptance cases build the largest payloads the app
 *  legitimately sends and assert validation lets them through. */

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  const ctor = MockAnthropic as unknown as typeof MockAnthropic & {
    RateLimitError: new (message?: string) => Error;
    AuthenticationError: new (message?: string) => Error;
  };
  ctor.RateLimitError = class extends Error {};
  ctor.AuthenticationError = class extends Error {};
  return { default: ctor };
});
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
        })),
        listFactors: vi.fn(async () => ({ data: { totp: [], all: [] } })),
      },
    },
  })),
}));
vi.mock("@/lib/auth/trusted-device", () => ({
  trustedDeviceOption: vi.fn(async () => ({})),
}));
vi.mock("@/lib/ai/env", () => ({
  getAnthropicConfig: vi.fn(() => ({ apiKey: "sk-test" })),
}));
vi.mock("@/lib/ai/off-search", () => ({
  searchOpenFoodFactsServer: vi.fn(async () => []),
}));
// Metering is covered in lib/billing; here every call is cleared (Pro tier
// so the Pro-gated meal-insights and Plus-gated import routes are reachable).
vi.mock("@/lib/billing/usage", () => ({
  checkAndIncrementAiUsage: vi.fn(async () => ({
    allowed: true,
    tier: "pro",
    used: null,
    cap: null,
    debitedPeriod: null,
  })),
  loadUserTier: vi.fn(async () => "pro"),
  refundAiUsage: vi.fn(async () => {}),
}));

type Handler = (req: Request) => Promise<Response>;

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const s = (n: number) => "x".repeat(n);
/** A base64 string whose decoded size is just over AI_MAX_IMAGE_BYTES but
 *  whose request body is still under the vision routes' byte cap. */
const OVERSIZED_IMAGE_BASE64_CHARS = 4 * Math.ceil(AI_MAX_IMAGE_BYTES / 3) + 8;
const food = (name: string) => ({
  name,
  protein: 10,
  carbs: 10,
  fat: 5,
  calories: 125,
});
const foods = (n: number) =>
  Array.from({ length: n }, (_, i) => food(`Custom food ${i}`));
const foodItem = (id: number, name = `Item ${id}`) => ({
  ...food(name),
  id,
  portionSize: 100,
});
const meal = (id: number, name: string, foodCount = 5) => ({
  id,
  name,
  foods: Array.from({ length: foodCount }, (_, i) => foodItem(i)),
});

const MEAL_PLAN = {
  targets: { protein: 150, carbs: 200, fat: 70, calories: 2050 },
  dietPreference: "omnivore",
  mealNames: ["Breakfast", "Lunch", "Dinner", "Snacks"],
};
const IMAGE = { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" };
const RECIPE = {
  id: "8d3e6f0a-1c2b-4d5e-9f00-112233445566",
  name: "Chicken curry",
  protein: 40,
  carbs: 50,
  fat: 15,
  calories: 500,
};
const SUGGEST_DAY = {
  targets: { protein: 100, carbs: 150, fat: 50, calories: 1500 },
  mealSlots: ["Breakfast", "Lunch", "Dinner"],
  recipes: [RECIPE],
};
const INSIGHT_MEAL = {
  name: "Lunch",
  calories: 600,
  protein: 30,
  carbs: 60,
  fat: 20,
  foods: [{ name: "Rice", grams: 150 }],
};

beforeEach(() => {
  vi.mocked(checkAndIncrementAiUsage).mockClear();
  mockCreate.mockReset();
  // Acceptance cases only need to prove validation passed; failing the
  // model call keeps every route on its short error path.
  mockCreate.mockRejectedValue(new Error("model unavailable in test"));
});

describe("AI routes reject oversized prompt input before metering or calling the model", () => {
  const cases: Array<[string, Handler, string, unknown, number]> = [
    // meal-plan
    [
      "meal-plan: refinement over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, refinement: s(1001) },
      400,
    ],
    [
      "meal-plan: too many meal slots",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        mealNames: Array.from({ length: 9 }, (_, i) => `Meal ${i}`),
      },
      400,
    ],
    [
      "meal-plan: meal slot name over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, mealNames: [s(101)] },
      400,
    ],
    [
      "meal-plan: too many custom foods",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, customFoods: foods(501) },
      400,
    ],
    [
      "meal-plan: custom food name over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, customFoods: [food(s(201))] },
      400,
    ],
    [
      "meal-plan: custom food category over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, customFoods: [{ ...food("Tofu"), category: s(101) }] },
      400,
    ],
    [
      "meal-plan: too many allergies",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        allergies: Array.from({ length: 101 }, (_, i) => `a${i}`),
      },
      400,
    ],
    [
      "meal-plan: disliked-food tag over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, dislikedFoods: [s(101)] },
      400,
    ],
    [
      "meal-plan: cuisine tag over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, cuisinePreferences: [s(101)] },
      400,
    ],
    [
      "meal-plan: target meal name over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, targetMealName: s(101) },
      400,
    ],
    [
      "meal-plan: too many previous meals",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        refinement: "x",
        previousMeals: Array.from({ length: 9 }, (_, i) => meal(i, `M${i}`)),
      },
      400,
    ],
    [
      "meal-plan: too many foods in a previous meal",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, refinement: "x", previousMeals: [meal(1, "Lunch", 101)] },
      400,
    ],
    [
      "meal-plan: previous-meal food name over the cap",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        refinement: "x",
        previousMeals: [{ id: 1, name: "Lunch", foods: [foodItem(1, s(201))] }],
      },
      400,
    ],
    [
      "meal-plan: recently-eaten name over the cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, recentlyEatenFoods: [{ name: s(201), count: 2 }] },
      400,
    ],
    [
      "meal-plan: too many recently-eaten foods",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        recentlyEatenFoods: Array.from({ length: 501 }, (_, i) => ({
          name: `f${i}`,
          count: 1,
        })),
      },
      400,
    ],
    [
      "meal-plan: pantry unit over the cap",
      mealPlan,
      "/api/meal-plan",
      {
        ...MEAL_PLAN,
        pantryItems: [{ name: "Rice", quantity: 1, unit: s(41) }],
      },
      400,
    ],
    [
      "meal-plan: body over the byte cap",
      mealPlan,
      "/api/meal-plan",
      { ...MEAL_PLAN, padding: s(AI_MAX_JSON_BODY_BYTES) },
      413,
    ],
    // identify-meal
    [
      "identify-meal: too many custom foods",
      identifyMeal,
      "/api/identify-meal",
      { ...IMAGE, customFoods: foods(501) },
      400,
    ],
    [
      "identify-meal: custom food name over the cap",
      identifyMeal,
      "/api/identify-meal",
      { ...IMAGE, customFoods: [food(s(201))] },
      400,
    ],
    [
      "identify-meal: image over the decoded-size cap",
      identifyMeal,
      "/api/identify-meal",
      { ...IMAGE, imageBase64: s(OVERSIZED_IMAGE_BASE64_CHARS) },
      413,
    ],
    // identify-pantry
    [
      "identify-pantry: unsupported media type",
      identifyPantry,
      "/api/identify-pantry",
      { ...IMAGE, mediaType: "image/gif" },
      400,
    ],
    [
      "identify-pantry: image over the decoded-size cap",
      identifyPantry,
      "/api/identify-pantry",
      { ...IMAGE, imageBase64: s(OVERSIZED_IMAGE_BASE64_CHARS) },
      413,
    ],
    // voice-log
    [
      "voice-log: too many custom foods",
      voiceLog,
      "/api/voice-log",
      { transcript: "an apple", customFoods: foods(501) },
      400,
    ],
    [
      "voice-log: custom food name over the cap",
      voiceLog,
      "/api/voice-log",
      { transcript: "an apple", customFoods: [food(s(201))] },
      400,
    ],
    [
      "voice-log: whitespace-only transcript",
      voiceLog,
      "/api/voice-log",
      { transcript: "   " },
      400,
    ],
    [
      "voice-log: transcript over the cap",
      voiceLog,
      "/api/voice-log",
      { transcript: s(1001) },
      413,
    ],
    [
      "voice-log: body over the byte cap",
      voiceLog,
      "/api/voice-log",
      { transcript: s(AI_MAX_JSON_BODY_BYTES) },
      413,
    ],
    // recipes/generate
    [
      "recipes/generate: hint over the dialog's limit",
      recipesGenerate,
      "/api/recipes/generate",
      { dietPreference: "omnivore", hint: s(201) },
      400,
    ],
    [
      "recipes/generate: too many custom foods",
      recipesGenerate,
      "/api/recipes/generate",
      { dietPreference: "omnivore", customFoods: foods(501) },
      400,
    ],
    [
      "recipes/generate: allergy tag over the cap",
      recipesGenerate,
      "/api/recipes/generate",
      { dietPreference: "omnivore", allergies: [s(101)] },
      400,
    ],
    [
      "recipes/generate: pantry name over the cap",
      recipesGenerate,
      "/api/recipes/generate",
      {
        dietPreference: "omnivore",
        pantryItems: [{ name: s(201), quantity: 1, unit: "g" }],
      },
      400,
    ],
    // suggest-day
    [
      "suggest-day: recipe name over the cap",
      suggestDay,
      "/api/suggest-day",
      { ...SUGGEST_DAY, recipes: [{ ...RECIPE, name: s(201) }] },
      400,
    ],
    [
      "suggest-day: recipe cuisine over the cap",
      suggestDay,
      "/api/suggest-day",
      { ...SUGGEST_DAY, recipes: [{ ...RECIPE, cuisine: s(101) }] },
      400,
    ],
    [
      "suggest-day: recipe id over the cap",
      suggestDay,
      "/api/suggest-day",
      { ...SUGGEST_DAY, recipes: [{ ...RECIPE, id: s(101) }] },
      400,
    ],
    [
      "suggest-day: meal slot name over the cap",
      suggestDay,
      "/api/suggest-day",
      { ...SUGGEST_DAY, mealSlots: [s(101)] },
      400,
    ],
    // meal-insights
    [
      "meal-insights: food name over the cap",
      mealInsights,
      "/api/meal-insights",
      { meal: { ...INSIGHT_MEAL, foods: [{ name: s(201), grams: 10 }] } },
      400,
    ],
    [
      "meal-insights: unknown micronutrient key",
      mealInsights,
      "/api/meal-insights",
      { meal: { ...INSIGHT_MEAL, microPctOfTarget: { [s(5000)]: 10 } } },
      400,
    ],
    // recipes/import-from-url
    [
      "import-from-url: url over the cap",
      importFromUrl,
      "/api/recipes/import-from-url",
      { url: `https://example.com/${s(2048)}`, parseWithAi: true },
      400,
    ],
    // shopping/suggest
    [
      "shopping/suggest: body over the byte cap",
      shoppingSuggest,
      "/api/shopping/suggest",
      { items: [], padding: s(AI_MAX_JSON_BODY_BYTES) },
      413,
    ],
  ];

  it.each(cases)("%s", async (_label, handler, path, body, status) => {
    const res = await handler(post(path, body));
    expect(res.status).toBe(status);
    expect(mockCreate).not.toHaveBeenCalled();
    // A rejected request is never charged a credit.
    expect(checkAndIncrementAiUsage).not.toHaveBeenCalled();
  });
});

describe("AI routes accept the largest payloads the app legitimately sends", () => {
  const libraryFoods = Array.from({ length: 500 }, (_, i) => ({
    ...food(`${s(190)} ${String(i).padStart(3, "0")}`),
    category: "Protein",
    subCategory: "Poultry",
    brand: "Some brand",
    dietKind: "land-meat",
  }));

  it.each(REFINERS.map((r) => [r.id, r.text]))(
    "meal-plan accepts the %s refiner with a full library and day",
    async (_id, text) => {
      const res = await mealPlan(
        post("/api/meal-plan", {
          ...MEAL_PLAN,
          customFoods: libraryFoods,
          cuisinePreferences: ["Italian", "Japanese", "Mexican"],
          allergies: ["peanut", "shellfish"],
          dislikedFoods: ["liver"],
          refinement: text,
          previousMeals: MEAL_PLAN.mealNames.map((name, i) =>
            meal(i + 1, name, 12),
          ),
          recentlyEatenFoods: Array.from({ length: 30 }, (_, i) => ({
            name: `Food ${i}`,
            count: 3,
          })),
          pantryItems: Array.from({ length: 60 }, (_, i) => ({
            name: `Pantry item ${i}`,
            quantity: 2,
            unit: "cans",
          })),
          market: "it",
        }),
      );
      expect([400, 413]).not.toContain(res.status);
      expect(mockCreate).toHaveBeenCalled();
    },
  );

  it("meal-insights accepts every known micronutrient key", async () => {
    const microPctOfTarget = Object.fromEntries(
      MICRONUTRIENT_KEYS.map((k) => [k, 50]),
    );
    const res = await mealInsights(
      post("/api/meal-insights", {
        meal: { ...INSIGHT_MEAL, microPctOfTarget },
        flags: ["Low fiber"],
      }),
    );
    expect([400, 413]).not.toContain(res.status);
    expect(mockCreate).toHaveBeenCalled();
  });

  it("recipes/generate accepts every cuisine, a full-length hint and a full library", async () => {
    const res = await recipesGenerate(
      post("/api/recipes/generate", {
        dietPreference: "omnivore",
        cuisinePreferences: [...CUISINES],
        customFoods: libraryFoods,
        hint: s(200),
      }),
    );
    expect([400, 413]).not.toContain(res.status);
    expect(mockCreate).toHaveBeenCalled();
  });

  it("identify-meal accepts a full custom-food library", async () => {
    const res = await identifyMeal(
      post("/api/identify-meal", { ...IMAGE, customFoods: libraryFoods }),
    );
    expect([400, 413]).not.toContain(res.status);
    expect(mockCreate).toHaveBeenCalled();
  });
});
