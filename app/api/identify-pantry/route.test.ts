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
      // assertAal2 reads the AAL level; no MFA enrolled → no upgrade.
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
  return new Request("http://localhost/api/identify-pantry", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAA=";
const SAMPLE_BODY = {
  imageBase64: SAMPLE_IMAGE,
  mediaType: "image/jpeg" as const,
};

type ItemsResponse = {
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    confidence: string;
  }>;
};

describe("/api/identify-pantry POST", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  function stubItems(items: unknown[]) {
    mockCreate.mockResolvedValue({
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "submit_pantry_items",
          input: { items },
        },
      ],
      stop_reason: "tool_use",
    });
  }

  it("resolves the AI submission into a cleaned item list", async () => {
    stubItems([
      { name: "eggs", quantity: 6, unit: "Eggs", confidence: "high" },
      { name: "Canned chickpeas.", quantity: 2, unit: "cans" },
    ]);
    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ItemsResponse;
    expect(json.items).toHaveLength(2);
    // Name capitalized + trailing punctuation stripped; unit lowercased.
    expect(json.items[0]).toEqual({
      name: "Eggs",
      quantity: 6,
      unit: "eggs",
      confidence: "high",
    });
    expect(json.items[1]).toEqual({
      name: "Canned chickpeas",
      quantity: 2,
      unit: "cans",
      // confidence omitted by the model → defaults to medium.
      confidence: "medium",
    });
  });

  it("clamps a bad quantity to 1 and blanks unit to 'item'", async () => {
    stubItems([{ name: "Rice", quantity: -5, unit: "  " }]);
    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as ItemsResponse;
    expect(json.items[0].quantity).toBe(1);
    expect(json.items[0].unit).toBe("item");
  });

  it("rounds a fractional quantity to a whole count", async () => {
    stubItems([{ name: "Apples", quantity: 3.6, unit: "apples" }]);
    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as ItemsResponse;
    expect(json.items[0].quantity).toBe(4);
  });

  it("drops entries with no usable name", async () => {
    stubItems([
      { name: "   ", quantity: 1, unit: "x" },
      { quantity: 1, unit: "x" },
      { name: "Milk", quantity: 1, unit: "carton" },
    ]);
    const res = await POST(makeRequest(SAMPLE_BODY));
    const json = (await res.json()) as ItemsResponse;
    expect(json.items.map((i) => i.name)).toEqual(["Milk"]);
  });

  it("400s on a malformed body (bad mediaType)", async () => {
    const res = await POST(
      makeRequest({ imageBase64: SAMPLE_IMAGE, mediaType: "image/gif" }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("502s when the model returns no tool submission", async () => {
    mockCreate.mockResolvedValue({
      id: "m1",
      content: [{ type: "text", text: "I can't see anything." }],
      stop_reason: "end_turn",
    });
    const res = await POST(makeRequest(SAMPLE_BODY));
    expect(res.status).toBe(502);
  });
});
