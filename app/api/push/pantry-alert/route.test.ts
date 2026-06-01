import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { mockSendPush, mockGetUser, mockFrom, deleteCalls } = vi.hoisted(() => ({
  mockSendPush: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  deleteCalls: [] as string[],
}));

vi.mock("@/lib/push/send", () => ({ sendPush: mockSendPush }));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://app.test" }));
vi.mock("@/lib/auth/trusted-device", () => ({
  trustedDeviceOption: vi.fn(async () => ({})),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
      // assertAal2: no MFA enrolled → aal1/aal1, no upgrade required.
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
        })),
        listFactors: vi.fn(async () => ({ data: { totp: [], all: [] } })),
      },
    },
    from: mockFrom,
  })),
}));

/** Build a chainable query stub matching the calls the route makes:
 *  `.from("push_subscriptions").select(...).eq(...)` resolves to `subs`,
 *  and `.from(...).delete().eq("id", x)` records the deleted id. */
function installSupabaseTable(subs: unknown[]) {
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: async () => ({ data: subs, error: null }) }),
    delete: () => ({
      eq: async (_col: string, id: string) => {
        deleteCalls.push(id);
        return { data: null, error: null };
      },
    }),
  }));
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/push/pantry-alert", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const BODY = { itemName: "Eggs", quantity: 1, unit: "eggs" };

const SUB = {
  id: "sub-1",
  endpoint: "https://push.test/abc",
  p256dh: "p",
  auth: "a",
};

describe("/api/push/pantry-alert POST", () => {
  beforeEach(() => {
    mockSendPush.mockReset();
    mockFrom.mockReset();
    deleteCalls.length = 0;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "u@example.com" } },
    });
  });

  it("sends a push to every subscription and reports the count", async () => {
    installSupabaseTable([SUB, { ...SUB, id: "sub-2" }]);
    mockSendPush.mockResolvedValue({ ok: true, status: 201 });

    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; sent: number };
    expect(json).toEqual({ ok: true, sent: 2 });
    expect(mockSendPush).toHaveBeenCalledTimes(2);
    // Payload deep-links to the pantry view and carries a per-item tag.
    expect(mockSendPush.mock.calls[0][1]).toMatchObject({
      url: "https://app.test/app?view=pantry",
      tag: "pantry-low:Eggs",
    });
  });

  it("prunes a subscription the provider reports as gone (404/410)", async () => {
    installSupabaseTable([SUB]);
    mockSendPush.mockResolvedValue({
      ok: false,
      gone: true,
      status: 410,
      error: "gone",
    });

    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sent: number };
    expect(json.sent).toBe(0);
    expect(deleteCalls).toEqual(["sub-1"]);
  });

  it("does not prune on a transient send failure", async () => {
    installSupabaseTable([SUB]);
    mockSendPush.mockResolvedValue({
      ok: false,
      gone: false,
      status: 500,
      error: "boom",
    });

    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(200);
    expect(deleteCalls).toEqual([]);
  });

  it("401s when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(BODY));
    expect(res.status).toBe(401);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("400s on a malformed body (missing itemName)", async () => {
    installSupabaseTable([SUB]);
    const res = await POST(makeRequest({ quantity: 1, unit: "eggs" }));
    expect(res.status).toBe(400);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});
