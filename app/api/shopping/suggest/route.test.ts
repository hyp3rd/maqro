import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import type { ShoppingSuggestion } from "./route";

const { mockCreate, mockGetUser, mockGetAnthropicConfig, mockUsage } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockGetUser: vi.fn(),
    mockGetAnthropicConfig: vi.fn(),
    mockUsage: vi.fn(),
  }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

vi.mock("@/lib/ai/env", () => ({ getAnthropicConfig: mockGetAnthropicConfig }));
vi.mock("@/lib/billing/usage", () => ({ checkAndIncrementAiUsage: mockUsage }));
vi.mock("@/lib/auth/trusted-device", () => ({
  trustedDeviceOption: vi.fn(async () => ({})),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
        })),
        listFactors: vi.fn(async () => ({ data: { totp: [], all: [] } })),
      },
    },
  })),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/shopping/suggest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const BODY = {
  items: [
    { name: "Brown Rice", quantity: 0, unit: "kg" },
    { name: "Eggs", quantity: 1, unit: "eggs" },
  ],
};

describe("/api/shopping/suggest POST", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockGetAnthropicConfig.mockReset();
    mockUsage.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "u@example.com" } },
    });
    mockGetAnthropicConfig.mockReturnValue({ apiKey: "sk-test" });
    mockUsage.mockResolvedValue({ allowed: true, used: 1, cap: 25 });
  });

  it("returns the AI list when configured and within cap", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "submit_shopping_list",
          input: {
            items: [
              {
                name: "Brown rice",
                quantity: 1,
                unit: "kg",
                category: "Pantry & Dry Goods",
              },
            ],
          },
        },
      ],
    });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ShoppingSuggestion;
    expect(json.ai).toBe(true);
    expect(json.items).toEqual([
      {
        name: "Brown rice",
        quantity: 1,
        unit: "kg",
        category: "Pantry & Dry Goods",
      },
    ]);
    expect(mockUsage).toHaveBeenCalledOnce();
  });

  it("coerces a bad AI category to Other and a bad quantity to 1", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "submit_shopping_list",
          input: {
            items: [
              { name: "Mystery", quantity: -3, unit: "", category: "Snacks" },
            ],
          },
        },
      ],
    });
    const res = await POST(makeRequest(BODY));
    const json = (await res.json()) as ShoppingSuggestion;
    expect(json.items[0]).toEqual({
      name: "Mystery",
      quantity: 1,
      unit: "unit",
      category: "Other",
    });
  });

  it("falls back deterministically when AI is unconfigured (no cap spend)", async () => {
    mockGetAnthropicConfig.mockReturnValue(null);
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ShoppingSuggestion;
    expect(json.ai).toBe(false);
    expect(json.items.map((i) => i.name)).toEqual(["Brown Rice", "Eggs"]);
    expect(json.items[0].category).toBe("Pantry & Dry Goods");
    expect(json.items[1].category).toBe("Dairy & Eggs");
    expect(mockUsage).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back (not 402) when over the monthly cap", async () => {
    mockUsage.mockResolvedValue({ allowed: false, used: 25, cap: 25 });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ShoppingSuggestion;
    expect(json.ai).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back when the AI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ShoppingSuggestion;
    expect(json.ai).toBe(false);
    expect(json.items.length).toBeGreaterThan(0);
  });

  it("401s when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(makeRequest({ items: "nope" }));
    expect(res.status).toBe(400);
  });
});
