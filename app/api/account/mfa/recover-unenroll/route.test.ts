import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/account/mfa/recover-unenroll — the lost-authenticator
 *  step-down. The load-bearing contract is that removal requires BOTH a session
 *  AND a valid single-use recovery grant; a session alone must never strip 2FA.
 */

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockGetUser,
  mockConsume,
  mockListFactors,
  mockDeleteFactor,
  mockRateLimit,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockGetUser: vi.fn(),
  mockConsume: vi.fn(),
  mockListFactors: vi.fn(),
  mockDeleteFactor: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: mockRateLimit,
  ipFromRequest: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/auth/recovery-grant", () => ({
  consumeRecoveryGrant: mockConsume,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        mfa: { listFactors: mockListFactors, deleteFactor: mockDeleteFactor },
      },
    },
  })),
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/account/mfa/recover-unenroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const verifiedTotp = { id: "f1", factor_type: "totp", status: "verified" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({ auth: { getUser: mockGetUser } });
  mockGetSupabaseSecretConfig.mockReturnValue({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  });
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockConsume.mockResolvedValue(true);
  mockListFactors.mockResolvedValue({
    data: { factors: [verifiedTotp] },
    error: null,
  });
  mockDeleteFactor.mockResolvedValue({ data: {}, error: null });
});

async function run(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(post(body));
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("POST /api/account/mfa/recover-unenroll", () => {
  it("401s when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { status } = await run({ rt: "tok" });
    expect(status).toBe(401);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockDeleteFactor).not.toHaveBeenCalled();
  });

  it("400s on a missing rt token", async () => {
    const { status } = await run({});
    expect(status).toBe(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("403s and removes NOTHING when the grant is invalid (session alone is not enough)", async () => {
    mockConsume.mockResolvedValue(false);
    const { status } = await run({ rt: "bad" });
    expect(status).toBe(403);
    expect(mockListFactors).not.toHaveBeenCalled();
    expect(mockDeleteFactor).not.toHaveBeenCalled();
  });

  it("removes every verified TOTP factor on a valid grant", async () => {
    mockListFactors.mockResolvedValue({
      data: {
        factors: [
          verifiedTotp,
          { id: "f2", factor_type: "totp", status: "verified" },
          { id: "u1", factor_type: "totp", status: "unverified" }, // skipped
          { id: "p1", factor_type: "phone", status: "verified" }, // skipped
        ],
      },
      error: null,
    });
    const { status, body } = await run({ rt: "good" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(2);
    expect(mockConsume).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "good",
      expect.any(Number),
    );
    expect(mockDeleteFactor).toHaveBeenCalledTimes(2);
    expect(mockDeleteFactor).toHaveBeenCalledWith({
      userId: "user-1",
      id: "f1",
    });
    expect(mockDeleteFactor).toHaveBeenCalledWith({
      userId: "user-1",
      id: "f2",
    });
  });

  it("502s if listing factors fails (after consuming the grant)", async () => {
    mockListFactors.mockResolvedValue({
      data: null,
      error: { message: "down" },
    });
    const { status } = await run({ rt: "good" });
    expect(status).toBe(502);
    expect(mockDeleteFactor).not.toHaveBeenCalled();
  });

  it("502s if a delete fails", async () => {
    mockDeleteFactor.mockResolvedValue({
      data: null,
      error: { message: "nope" },
    });
    const { status } = await run({ rt: "good" });
    expect(status).toBe(502);
  });

  it("503s when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValue(null);
    const { status } = await run({ rt: "good" });
    expect(status).toBe(503);
  });

  it("429s when rate-limited (and removes nothing)", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const { status } = await run({ rt: "good" });
    expect(status).toBe(429);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockDeleteFactor).not.toHaveBeenCalled();
  });
});
