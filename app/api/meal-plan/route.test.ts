import * as offSearch from "@/lib/ai/off-search";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Hoist the create-mock so it's defined before `vi.mock()` runs.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// Mock the Anthropic SDK. The route uses `new Anthropic({...}).messages.create(...)`
// plus `instanceof Anthropic.RateLimitError / AuthenticationError`, so the
// mocked default export must be a constructor with those static classes.
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

// Supabase: pretend the user is signed in.
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      })),
    },
  })),
}));

// Anthropic feature gate: pretend the key is configured.
vi.mock("@/lib/ai/env", () => ({
  getAnthropicConfig: vi.fn(() => ({ apiKey: "sk-test" })),
}));

// OFF search: tests stub the resolution per spec.
vi.mock("@/lib/ai/off-search", () => ({ searchOpenFoodFactsServer: vi.fn() }));

// Free-tier AI cap is checked at the top of the route. Tests don't
// care about cap enforcement — they stub the helper to always
// allow the call and report a low used count. The cap-enforcement
// path has its own dedicated tests in lib/billing/usage.test.ts.
vi.mock("@/lib/billing/usage", () => ({
  checkAndIncrementAiUsage: vi.fn(async () => ({
    allowed: true,
    isPremium: false,
    used: 1,
    cap: 25,
  })),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/meal-plan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_BODY = {
  targets: { protein: 150, carbs: 200, fat: 70, calories: 2050 },
  dietPreference: "omnivore" as const,
  mealNames: ["Breakfast"],
};

describe("/api/meal-plan POST — agent-loop hardening", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.mocked(offSearch.searchOpenFoodFactsServer).mockReset();
  });

  it("recovers when OFF throws: surfaces is_error to the model and returns 200", async () => {
    // Deep-clone every captured call: the route mutates the `messages`
    // array after each call returns (pushes assistant response + next
    // tool_result), so a reference snapshot wouldn't reflect what the API
    // actually saw on that specific turn.
    const captured: Array<{ messages: unknown[] }> = [];
    const scriptedResponses = [
      // Turn 1: model asks to search OFF.
      {
        id: "msg_1",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "search_open_food_facts",
            input: { query: "kimchi" },
          },
        ],
        stop_reason: "tool_use",
      },
      // Turn 2: model submits the final plan with a seed-catalog food.
      {
        id: "msg_2",
        content: [
          {
            type: "tool_use",
            id: "tool_2",
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [{ name: "Chicken Breast", portionGrams: 100 }],
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
      const next = scriptedResponses.shift();
      if (!next) throw new Error("unexpected extra mockCreate call");
      return next;
    });

    // OFF call throws — previously would propagate to a 500.
    vi.mocked(offSearch.searchOpenFoodFactsServer).mockRejectedValueOnce(
      new Error("Open Food Facts search failed (HTTP 502)"),
    );

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { meals: { foods: unknown[] }[] };
    expect(json.meals).toHaveLength(1);
    expect(json.meals[0].foods.length).toBeGreaterThan(0);

    // The model on turn 2 must have seen the is_error tool_result.
    expect(captured).toHaveLength(2);
    const messages = captured[1].messages;
    const lastUserMsg = messages[messages.length - 1] as {
      role: string;
      content: Array<{
        type: string;
        is_error?: boolean;
        content?: string;
        cache_control?: { type: string };
      }>;
    };
    expect(lastUserMsg.role).toBe("user");
    expect(Array.isArray(lastUserMsg.content)).toBe(true);
    const errBlock = lastUserMsg.content[0];
    expect(errBlock.type).toBe("tool_result");
    expect(errBlock.is_error).toBe(true);
    expect(errBlock.content).toMatch(/Open Food Facts search failed/);

    // And: cache_control is set on the last block of the most recent user
    // message so the next turn re-uses this transcript prefix.
    const lastBlock = lastUserMsg.content[lastUserMsg.content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("retries when submit_meal_plan resolves to zero foods and recovers on a corrected name", async () => {
    // Turn 1: model submits names that won't match anything in the seed
    // catalog. The route must NOT 502 — it should feed back an is_error
    // tool_result and let the model retry.
    // Turn 2: model submits a corrected name that resolves. 200.
    const captured: Array<{ messages: unknown[] }> = [];
    const scripted = [
      {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [
                    { name: "Phoenix Egg", portionGrams: 100 },
                    { name: "Dragon Bacon", portionGrams: 60 },
                  ],
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
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [{ name: "Chicken Breast", portionGrams: 100 }],
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
    const json = (await res.json()) as { meals: { foods: unknown[] }[] };
    expect(json.meals[0].foods.length).toBeGreaterThan(0);

    // Turn 2 must have seen an is_error tool_result citing the unmatched names.
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
    expect(errBlock.content).toMatch(/Phoenix Egg/);
    expect(errBlock.content).toMatch(/Dragon Bacon/);
  });

  it("marks the initial user message with cache_control on the first turn", async () => {
    const captured: Array<{ messages: unknown[] }> = [];
    mockCreate.mockImplementation(async (params: { messages: unknown[] }) => {
      captured.push(structuredClone(params));
      return {
        id: "msg_1",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [{ name: "Chicken Breast", portionGrams: 100 }],
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

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const messages = captured[0].messages;
    const firstUser = messages[0] as {
      role: string;
      content: Array<{ type: string; cache_control?: { type: string } }>;
    };
    expect(firstUser.role).toBe("user");
    expect(Array.isArray(firstUser.content)).toBe(true);
    expect(firstUser.content[0].type).toBe("text");
    expect(firstUser.content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("retries when the submitted plan trips a coherence rule and accepts the corrected plan", async () => {
    // Turn 1: standalone-fat lunch (only Olive Oil). The validator's
    // standalone-fat rule must catch it and feed back a tool_result
    // is_error citing the rule. Turn 2: corrected to a multi-food
    // plan — accepted, 200 response.
    const captured: Array<{ messages: unknown[] }> = [];
    const scripted = [
      {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [{ name: "Olive Oil", portionGrams: 65 }],
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
            name: "submit_meal_plan",
            input: {
              meals: [
                {
                  name: "Breakfast",
                  foods: [
                    { name: "Oats", portionGrams: 60 },
                    { name: "Greek Yogurt", portionGrams: 200 },
                  ],
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
      meals: { foods: unknown[] }[];
      coherenceIssues?: unknown;
    };
    expect(json.meals[0].foods.length).toBeGreaterThan(0);
    // The accepted plan is clean → no coherenceIssues in response.
    expect(json.coherenceIssues).toBeUndefined();

    // Turn 2 must have seen an is_error tool_result naming the rule's
    // complaint (standalone fat / "pure fat, not a meal").
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
    expect(errBlock.content).toMatch(/pure fat/);
  });

  it("accepts a flawed plan on the final iteration and attaches coherenceIssues to the response", async () => {
    // Every iteration the model submits the same standalone-fat plan.
    // The forced-submit on the final iteration accepts it; the
    // response carries `coherenceIssues` so the client can warn the
    // user rather than silently shipping the bad plan.
    const badPlan = {
      id: "msg-bad",
      content: [
        {
          type: "tool_use",
          id: "t-bad",
          name: "submit_meal_plan",
          input: {
            meals: [
              {
                name: "Breakfast",
                foods: [{ name: "Olive Oil", portionGrams: 65 }],
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    };
    // MAX_ITERATIONS = 5 — the route will keep retrying up to that
    // many times. Seed the mock with enough copies (with unique ids
    // since structuredClone can't share references across calls).
    mockCreate.mockImplementation(async () => structuredClone(badPlan));

    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      meals: { foods: unknown[] }[];
      coherenceIssues?: Array<{ code: string; message: string }>;
    };
    expect(json.meals[0].foods.length).toBeGreaterThan(0);
    expect(Array.isArray(json.coherenceIssues)).toBe(true);
    expect(json.coherenceIssues?.[0].code).toBe("standalone-fat");
  });

  it("passes refinement + previousMeals into the system prompt and the user message", async () => {
    // Refiner pills (e.g. "Lower sugars") fire a request with these two
    // optional fields. The AI must see the refinement as an extra rule
    // in the system prompt AND the previous meals enumerated in the
    // user message so it has context for what to adjust.
    const captured: Array<{
      system: unknown;
      messages: Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
    }> = [];
    mockCreate.mockImplementation(
      async (params: {
        system: unknown;
        messages: Array<{
          role: string;
          content: Array<{ type: string; text?: string }>;
        }>;
      }) => {
        captured.push(structuredClone(params));
        return {
          id: "m-refine",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "submit_meal_plan",
              input: {
                meals: [
                  {
                    name: "Breakfast",
                    foods: [{ name: "Oats", portionGrams: 50 }],
                  },
                ],
              },
            },
          ],
          stop_reason: "tool_use",
        };
      },
    );

    const res = await POST(
      makeRequest({
        ...SAMPLE_BODY,
        refinement: "Reduce added sugars and high-sugar foods.",
        previousMeals: [
          {
            id: 1,
            name: "Breakfast",
            foods: [
              {
                id: 1,
                name: "Sugary cereal",
                protein: 4,
                carbs: 80,
                fat: 2,
                calories: 380,
                portionSize: 60,
              },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(captured.length).toBeGreaterThanOrEqual(1);

    // The system prompt is built as an array of text blocks; pull the
    // joined text out so we can substring-match.
    const systemBlocks = captured[0].system as Array<{ text: string }>;
    const systemText = systemBlocks
      .map((b) => (typeof b === "string" ? b : (b.text ?? "")))
      .join("\n");
    expect(systemText).toMatch(/Reduce added sugars and high-sugar foods\./);

    // The initial user message should enumerate the previous meals so
    // the AI knows what to start from.
    const firstUserText = (
      captured[0].messages[0].content[0] as { text: string }
    ).text;
    expect(firstUserText).toMatch(/Previously suggested plan/);
    expect(firstUserText).toMatch(/Sugary cereal/);
  });
});
