import * as offSearch from "@/lib/ai/off-search";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

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
    },
  })),
}));

vi.mock("@/lib/ai/env", () => ({
  getAnthropicConfig: vi.fn(() => ({ apiKey: "sk-test" })),
}));

vi.mock("@/lib/ai/off-search", () => ({ searchOpenFoodFactsServer: vi.fn() }));

// Free-tier AI cap stub. Cap enforcement is tested in
// lib/billing/usage.test.ts; here we just need the route to proceed.
vi.mock("@/lib/billing/usage", () => ({
  checkAndIncrementAiUsage: vi.fn(async () => ({
    allowed: true,
    isPremium: false,
    used: 1,
    cap: 25,
  })),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/recipes/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_BODY = {
  dietPreference: "omnivore" as const,
  hint: "something quick",
};

describe("/api/recipes/generate POST", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.mocked(offSearch.searchOpenFoodFactsServer).mockReset();
  });

  it("happy path: AI submits a valid recipe, route returns 200 with the resolved draft", async () => {
    mockCreate.mockImplementationOnce(async () => ({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_recipe",
          input: {
            name: "Chicken & oats",
            ingredients: [
              { name: "Chicken Breast", portionGrams: 150 },
              { name: "Oats", portionGrams: 80 },
            ],
            cuisine: "American",
            notes: "Cook the chicken, soak the oats.",
          },
        },
      ],
      stop_reason: "tool_use",
    }));

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      recipe: { name: string; ingredients: { foodName: string }[] };
    };
    expect(json.recipe.name).toBe("Chicken & oats");
    expect(json.recipe.ingredients.length).toBe(2);
    expect(json.recipe.ingredients.map((i) => i.foodName).sort()).toEqual([
      "Chicken Breast",
      "Oats",
    ]);
  });

  it("recovers when OFF throws: surfaces is_error and finishes via submit_recipe", async () => {
    const captured: Array<{ messages: unknown[] }> = [];
    const scripted = [
      {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "search_open_food_facts",
            input: { query: "kimchi" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        id: "m2",
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "submit_recipe",
            input: {
              name: "Simple",
              ingredients: [{ name: "Oats", portionGrams: 80 }],
            },
          },
        ],
        stop_reason: "tool_use",
      },
    ];
    mockCreate.mockImplementation(async (params: { messages: unknown[] }) => {
      captured.push(structuredClone(params));
      const next = scripted.shift();
      if (!next) throw new Error("unexpected extra mockCreate call");
      return next;
    });
    vi.mocked(offSearch.searchOpenFoodFactsServer).mockRejectedValueOnce(
      new Error("Open Food Facts search failed (HTTP 502)"),
    );

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);

    // Turn 2 must have seen the is_error tool_result.
    expect(captured).toHaveLength(2);
    const turn2 = captured[1].messages;
    const last = turn2[turn2.length - 1] as {
      role: string;
      content: Array<{ type: string; is_error?: boolean; content?: string }>;
    };
    expect(last.role).toBe("user");
    const err = last.content[0];
    expect(err.is_error).toBe(true);
    expect(err.content).toMatch(/Open Food Facts search failed/);
  });

  it("validation feedback: empty submit triggers retry with unmatched names cited", async () => {
    const captured: Array<{ messages: unknown[] }> = [];
    const scripted = [
      {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "submit_recipe",
            input: {
              name: "Fantasy",
              ingredients: [
                { name: "Phoenix Egg", portionGrams: 60 },
                { name: "Dragon Bacon", portionGrams: 100 },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        id: "m2",
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "submit_recipe",
            input: {
              name: "Corrected",
              ingredients: [
                { name: "Chicken Breast", portionGrams: 150 },
                { name: "Oats", portionGrams: 80 },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      },
    ];
    mockCreate.mockImplementation(async (params: { messages: unknown[] }) => {
      captured.push(structuredClone(params));
      const next = scripted.shift();
      if (!next) throw new Error("unexpected extra mockCreate call");
      return next;
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);

    // Turn 2 must have seen the validation is_error tool_result.
    expect(captured).toHaveLength(2);
    const turn2 = captured[1].messages;
    const last = turn2[turn2.length - 1] as {
      role: string;
      content: Array<{ type: string; is_error?: boolean; content?: string }>;
    };
    expect(last.role).toBe("user");
    const err = last.content[0];
    expect(err.is_error).toBe(true);
    expect(err.content).toMatch(/Phoenix Egg/);
    expect(err.content).toMatch(/Dragon Bacon/);
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    const aiEnv = await import("@/lib/ai/env");
    vi.mocked(aiEnv.getAnthropicConfig).mockReturnValueOnce(null);
    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("returns 400 on missing dietPreference", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/dietPreference/);
  });
});
