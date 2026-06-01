import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { mockGetUser, mockGetConfig } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://app.test" }));
vi.mock("@/lib/shopping/instacart", () => ({
  getInstacartConfig: mockGetConfig,
}));
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
  return new Request("http://localhost/api/shopping/instacart-cart", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const BODY = {
  title: "Restock",
  items: [{ name: "Brown rice", quantity: 1, unit: "kg" }, { name: "Eggs" }],
};

let fetchMock: ReturnType<typeof vi.fn>;

describe("/api/shopping/instacart-cart POST", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "u@example.com" } },
    });
    mockGetConfig.mockReturnValue({
      apiKey: "sk-instacart",
      base: "https://connect.dev.instacart.tools",
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the mapped line items and returns the cart URL", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        products_link_url: "https://instacart.test/cart/x",
      }),
    });

    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://instacart.test/cart/x" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://connect.dev.instacart.tools/idp/v1/products/products_link",
    );
    expect(init.headers.Authorization).toBe("Bearer sk-instacart");
    const sent = JSON.parse(init.body as string);
    expect(sent.link_type).toBe("shopping_list");
    expect(sent.line_items).toEqual([
      { name: "Brown rice", quantity: 1, unit: "kg" },
      { name: "Eggs" },
    ]);
    expect(sent.landing_page_configuration).toEqual({
      partner_linkback_url: "https://app.test/app?view=pantry",
      enable_pantry_items: true,
    });
  });

  it("503s when Instacart isn't configured", async () => {
    mockGetConfig.mockReturnValue(null);
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(401);
  });

  it("400s on an empty item list", async () => {
    const res = await POST(makeRequest({ title: "x", items: [] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502s when Instacart rejects the request", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable",
      json: async () => ({}),
    });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(502);
  });

  it("502s when Instacart returns no link", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(502);
  });
});
