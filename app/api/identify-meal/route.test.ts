import * as plan from "@/lib/ai/plan";
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

vi.mock("@/lib/ai/env", () => ({
  getAnthropicConfig: vi.fn(() => ({ apiKey: "sk-test" })),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/identify-meal", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAA="; // 1x1 PNG
const SAMPLE_BODY = {
  imageBase64: SAMPLE_IMAGE,
  mediaType: "image/jpeg" as const,
  dietPreference: "omnivore" as const,
};

describe("/api/identify-meal POST", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // Minimal AI-supplied macros used in tests where the food is matched
  // against the catalog (so the field is required by the tool schema but
  // ignored downstream).
  const STUB_MACROS = { protein: 0, carbs: 0, fat: 0, calories: 0 };

  it("sends an image content block on the user message and resolves the response", async () => {
    // Capture into an array so TS doesn't treat the closure-assigned
    // variable as `never` after narrowing — same workaround the
    // meal-plan/recipes route tests use.
    const captured: Array<{ messages: unknown[] }> = [];
    mockCreate.mockImplementation(async (params: { messages: unknown[] }) => {
      captured.push(structuredClone(params));
      return {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "submit_meal_foods",
            input: {
              foods: [
                // 'Chicken Breast' exists in the built-in catalog — the
                // catalog macros win even if the AI's estimates differ.
                {
                  name: "Chicken Breast",
                  portionGrams: 150,
                  confidence: "high",
                  macrosPer100g: {
                    protein: 25,
                    carbs: 0,
                    fat: 4,
                    calories: 140,
                  },
                },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      };
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      foods: Array<{
        name: string;
        portionGrams: number;
        confidence: string;
        estimated: boolean;
      }>;
    };
    expect(json.foods).toHaveLength(1);
    expect(json.foods[0].name).toBe("Chicken Breast");
    expect(json.foods[0].portionGrams).toBe(150);
    expect(json.foods[0].confidence).toBe("high");
    // Catalog match → not an AI estimate.
    expect(json.foods[0].estimated).toBe(false);

    // The Anthropic call must include an `image` content block on the
    // user message — that's the load-bearing assertion for vision.
    expect(captured).toHaveLength(1);
    const messages = captured[0].messages;
    const userMsg = messages[0] as {
      role: string;
      content: Array<{ type: string }>;
    };
    expect(userMsg.role).toBe("user");
    expect(userMsg.content.some((b) => b.type === "image")).toBe(true);
  });

  it("falls back to AI macros and marks `estimated: true` for foods not in the catalog", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_meal_foods",
          input: {
            foods: [
              {
                name: "Oats",
                portionGrams: 80,
                confidence: "high",
                macrosPer100g: STUB_MACROS,
              },
              {
                name: "Unicorn Bacon",
                portionGrams: 60,
                confidence: "low",
                macrosPer100g: {
                  protein: 12,
                  carbs: 1,
                  fat: 30,
                  calories: 340,
                },
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as {
      foods: Array<{
        name: string;
        estimated: boolean;
        per100g: { protein: number; calories: number };
      }>;
    };
    // Both foods are kept now — the unmatched one comes back with AI macros.
    expect(json.foods.map((f) => f.name)).toEqual(["Oats", "Unicorn Bacon"]);
    expect(json.foods[0].estimated).toBe(false);
    expect(json.foods[1].estimated).toBe(true);
    // AI macros plumb through unchanged when in range.
    expect(json.foods[1].per100g.protein).toBe(12);
    expect(json.foods[1].per100g.calories).toBe(340);
  });

  it("drops unmatched foods when the AI omitted or sent bogus macros", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_meal_foods",
          input: {
            foods: [
              // Missing macros entirely — drop.
              { name: "Mystery Item", portionGrams: 50 },
              // Negative protein — drop.
              {
                name: "Bad Macros",
                portionGrams: 50,
                macrosPer100g: { protein: -5, carbs: 1, fat: 1, calories: 10 },
              },
              // Matched against catalog — kept regardless.
              { name: "Oats", portionGrams: 50, macrosPer100g: STUB_MACROS },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as { foods: Array<{ name: string }> };
    expect(json.foods.map((f) => f.name)).toEqual(["Oats"]);
  });

  it("uses matchPick (substring fallback) so paraphrased names still resolve", async () => {
    const spy = vi.spyOn(plan, "matchPick");
    mockCreate.mockResolvedValueOnce({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_meal_foods",
          input: {
            foods: [
              // "rolled oats" should substring-match the built-in "Oats".
              {
                name: "rolled oats",
                portionGrams: 50,
                confidence: "medium",
                macrosPer100g: STUB_MACROS,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    const json = (await res.json()) as {
      foods: Array<{ name: string; estimated: boolean }>;
    };
    expect(json.foods).toHaveLength(1);
    expect(json.foods[0].name).toBe("Oats"); // resolved to the catalog name
    expect(json.foods[0].estimated).toBe(false);
  });

  it("clamps portionGrams to [5, 500] on the 5g grid", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_meal_foods",
          input: {
            foods: [
              {
                name: "Oats",
                portionGrams: 9999,
                confidence: "high",
                macrosPer100g: STUB_MACROS,
              },
              {
                name: "Olive Oil",
                portionGrams: 0.5,
                confidence: "high",
                macrosPer100g: STUB_MACROS,
              },
              {
                name: "Chicken Breast",
                portionGrams: 123,
                confidence: "high",
                macrosPer100g: STUB_MACROS,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as {
      foods: Array<{ name: string; portionGrams: number }>;
    };
    expect(json.foods.find((f) => f.name === "Oats")?.portionGrams).toBe(500);
    expect(json.foods.find((f) => f.name === "Olive Oil")?.portionGrams).toBe(
      5,
    );
    expect(
      json.foods.find((f) => f.name === "Chicken Breast")?.portionGrams,
    ).toBe(125); // 123 → snaps to nearest 5
  });

  it("returns 400 on missing imageBase64", async () => {
    const res = await POST(makeRequest({ mediaType: "image/jpeg" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on unsupported mediaType", async () => {
    const res = await POST(
      makeRequest({ imageBase64: SAMPLE_IMAGE, mediaType: "image/heic" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    const aiEnv = await import("@/lib/ai/env");
    vi.mocked(aiEnv.getAnthropicConfig).mockReturnValueOnce(null);
    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(503);
  });

  it("retries when the plausibility validator catches implausible AI macros and accepts the corrected submission", async () => {
    // Turn 1: model claims a totally implausible per-100g macro set
    // for an unknown food (sum > 100g and kcal mismatch).
    // Turn 2: model fixes both. The route resolves the corrected
    // submission and returns 200.
    const captured: Array<{ messages: unknown[] }> = [];
    const scripted = [
      {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "submit_meal_foods",
            input: {
              foods: [
                {
                  name: "Mystery casserole",
                  portionGrams: 200,
                  confidence: "low",
                  macrosPer100g: {
                    protein: 50,
                    carbs: 50,
                    fat: 50, // sum = 150g, impossible
                    calories: 999,
                  },
                },
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
            name: "submit_meal_foods",
            input: {
              foods: [
                {
                  name: "Tuna casserole",
                  portionGrams: 200,
                  confidence: "medium",
                  macrosPer100g: {
                    protein: 12,
                    carbs: 10,
                    fat: 5,
                    calories: 130,
                  },
                },
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
    const json = (await res.json()) as {
      foods: Array<{ name: string; estimated: boolean }>;
    };
    expect(json.foods).toHaveLength(1);
    expect(json.foods[0].name).toBe("Tuna casserole");
    expect(json.foods[0].estimated).toBe(true);

    // Turn 2 must have seen an is_error tool_result naming the
    // plausibility rule's complaint ("impossible" / "100 g").
    expect(captured).toHaveLength(2);
    const turn2 = captured[1].messages;
    const lastUserMsg = turn2[turn2.length - 1] as {
      role: string;
      content: Array<{ type: string; is_error?: boolean; content?: string }>;
    };
    expect(lastUserMsg.role).toBe("user");
    const errBlock = lastUserMsg.content[0];
    expect(errBlock.type).toBe("tool_result");
    expect(errBlock.is_error).toBe(true);
    expect(errBlock.content).toMatch(/impossible/);
  });

  it("drops AI-estimated items that still fail validation on the final iteration", async () => {
    // Every call returns the same implausible per-100g macros. After
    // exhausting MAX_ITERATIONS (3), the route returns 200 with the
    // bad item dropped — better than shipping garbage to the review
    // dialog.
    const badSubmission = {
      id: "m-bad",
      content: [
        {
          type: "tool_use",
          id: "t-bad",
          name: "submit_meal_foods",
          input: {
            foods: [
              {
                name: "Unknown dish",
                portionGrams: 100,
                confidence: "low",
                macrosPer100g: {
                  protein: 60,
                  carbs: 60,
                  fat: 60, // sum 180g — fails plausibility every time
                  calories: 999,
                },
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    };
    mockCreate.mockImplementation(async () => structuredClone(badSubmission));

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { foods: unknown[] };
    expect(json.foods).toHaveLength(0);
  });
});
