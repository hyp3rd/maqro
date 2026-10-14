import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH, POST } from "./route";

const USER_ID = "a0000000-0000-4000-8000-000000000001";

const { mockGetUser, mockGetClaims, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetClaims: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: { getUser: mockGetUser, getClaims: mockGetClaims },
    from: mockFrom,
  })),
}));

/** An MFA-enrolled user (per GoTrue) whose session only proved the first
 *  factor — the state an attacker holding just the email inbox is in. */
function signInEnrolledAtAal1() {
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: USER_ID,
        factors: [{ id: "f1", factor_type: "totp", status: "verified" }],
      },
    },
  });
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID, aal: "aal1", amr: [{ method: "otp" }] } },
    error: null,
  });
}

const params = { params: Promise.resolve({ id: "recipe-1" }) };

function jsonRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/recipes/recipe-1/share", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectMfaRequired(res: Response) {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { kind?: string };
  expect(body.kind).toBe("mfa-required");
  // The gate runs before any recipe read or write.
  expect(mockFrom).not.toHaveBeenCalled();
}

describe("/api/recipes/[id]/share — AAL2 gate on every handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInEnrolledAtAal1();
  });

  it("POST rejects an AAL1 session for an enrolled user", async () => {
    await expectMfaRequired(await POST(jsonRequest("POST", {}), params));
  });

  it("PATCH rejects an AAL1 session for an enrolled user", async () => {
    await expectMfaRequired(
      await PATCH(jsonRequest("PATCH", { visibility: "public" }), params),
    );
  });

  it("DELETE rejects an AAL1 session for an enrolled user", async () => {
    await expectMfaRequired(await DELETE(jsonRequest("DELETE"), params));
  });
});
