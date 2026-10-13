import type { Food } from "@/components/macro/types";
import {
  AI_MAX_BIAS_ITEMS,
  AI_MAX_CUSTOM_FOODS,
  AI_MAX_LABEL_CHARS,
  AI_MAX_NAME_CHARS,
  AI_MAX_REFINEMENT_CHARS,
  AI_MAX_UNIT_CHARS,
} from "@/lib/ai/request-limits";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AiPlanRequest, requestAiMealPlan } from "./ai-plan";

const { mockClientFetch } = vi.hoisted(() => ({ mockClientFetch: vi.fn() }));

vi.mock("@/lib/auth/client-fetch", () => ({ clientFetch: mockClientFetch }));

const food = (i: number): Food => ({
  name: `Food ${i}`,
  protein: 1,
  carbs: 1,
  fat: 1,
  calories: 17,
});

function request(overrides: Partial<AiPlanRequest> = {}): AiPlanRequest {
  return {
    targets: { protein: 150, carbs: 200, fat: 70, calories: 2050 },
    dietPreference: "omnivore",
    mealNames: ["Breakfast"],
    customFoods: [],
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    ...overrides,
  };
}

function sentBody(): AiPlanRequest {
  const init = mockClientFetch.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as AiPlanRequest;
}

beforeEach(() => {
  mockClientFetch.mockReset();
  mockClientFetch.mockResolvedValue(
    new Response(JSON.stringify({ meals: [] }), { status: 200 }),
  );
});

describe("requestAiMealPlan", () => {
  it("sends at most the route's custom-food limit, keeping the newest", async () => {
    // Callers pass listCustomFoods() order: newest first.
    const library = Array.from({ length: AI_MAX_CUSTOM_FOODS + 25 }, (_, i) =>
      food(i),
    );

    await requestAiMealPlan(request({ customFoods: library }));

    const sent = sentBody().customFoods;
    expect(sent).toHaveLength(AI_MAX_CUSTOM_FOODS);
    expect(sent[0]?.name).toBe("Food 0");
    expect(sent.at(-1)?.name).toBe(`Food ${AI_MAX_CUSTOM_FOODS - 1}`);
  });

  it("clamps the soft-bias lists to the route's limit", async () => {
    const many = Array.from({ length: AI_MAX_BIAS_ITEMS + 1 }, (_, i) => i);

    await requestAiMealPlan(
      request({
        recentlyEatenFoods: many.map((i) => ({ name: `f${i}`, count: 1 })),
        pantryItems: many.map((i) => ({
          name: `p${i}`,
          quantity: 1,
          unit: "g",
        })),
      }),
    );

    const sent = sentBody();
    expect(sent.recentlyEatenFoods).toHaveLength(AI_MAX_BIAS_ITEMS);
    expect(sent.pantryItems).toHaveLength(AI_MAX_BIAS_ITEMS);
  });

  it("fits long stored strings to the route's limits but sends slot names as-is", async () => {
    const long = "x".repeat(250);
    const plannedFood = {
      id: 1,
      name: long,
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
      portionSize: 100,
    };

    await requestAiMealPlan(
      request({
        mealNames: ["Breakfast", "Lunch"],
        customFoods: [{ ...food(1), name: long, category: long }],
        cuisinePreferences: [long],
        allergies: [long],
        dislikedFoods: [long],
        refinement: "y".repeat(AI_MAX_REFINEMENT_CHARS + 50),
        previousMeals: [{ id: 2, name: "Lunch", foods: [plannedFood] }],
        targetMealName: "Lunch",
        recentlyEatenFoods: [{ name: long, count: 3 }],
        pantryItems: [{ name: long, quantity: 1, unit: long }],
      }),
    );

    const sent = sentBody();
    expect(sent.customFoods[0]?.name).toHaveLength(AI_MAX_NAME_CHARS);
    expect(sent.customFoods[0]?.category).toHaveLength(AI_MAX_LABEL_CHARS);
    expect(sent.cuisinePreferences[0]).toHaveLength(AI_MAX_LABEL_CHARS);
    expect(sent.allergies[0]).toHaveLength(AI_MAX_LABEL_CHARS);
    expect(sent.dislikedFoods[0]).toHaveLength(AI_MAX_LABEL_CHARS);
    expect(sent.refinement).toHaveLength(AI_MAX_REFINEMENT_CHARS);
    expect(sent.previousMeals?.[0]?.foods[0]?.name).toHaveLength(
      AI_MAX_NAME_CHARS,
    );
    expect(sent.previousMeals?.[0]?.foods[0]?.portionSize).toBe(100);
    expect(sent.recentlyEatenFoods?.[0]?.name).toHaveLength(AI_MAX_NAME_CHARS);
    expect(sent.pantryItems?.[0]?.name).toHaveLength(AI_MAX_NAME_CHARS);
    expect(sent.pantryItems?.[0]?.unit).toHaveLength(AI_MAX_UNIT_CHARS);
    // The planner matches the returned meal to its slot by exact name.
    expect(sent.mealNames).toEqual(["Breakfast", "Lunch"]);
    expect(sent.previousMeals?.[0]?.name).toBe("Lunch");
    expect(sent.targetMealName).toBe("Lunch");
  });

  it("leaves a request within the limits unchanged", async () => {
    const req = request({ customFoods: [food(1), food(2)] });

    await requestAiMealPlan(req);

    expect(sentBody()).toEqual(req);
  });
});
