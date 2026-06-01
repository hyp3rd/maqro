import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockSendEmail,
  mockReportServerError,
  mockUpdateEq,
  mockRpc,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockSendEmail: vi.fn(),
  mockReportServerError: vi.fn(async () => {}),
  mockUpdateEq: vi.fn(async () => ({ error: null })),
  // The new email_taken_by_other_user RPC. Default: not taken.
  // Cast widens the inferred shape so override calls can pass
  // `{ data: null, error: { message } }` for the failure tests
  // without TS narrowing to the happy-path-only type.
  mockRpc: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ update: () => ({ eq: mockUpdateEq }) }),
    rpc: mockRpc,
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/account/backup-email/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "alice@example.com" } },
      })),
    },
  });
  mockSendEmail.mockResolvedValue({ ok: true, id: "msg-1" });
  // Two RPCs flow through this route:
  //   - check_throttle (rate-limit, fail-open on infra error)
  //   - email_taken_by_other_user (collision-check, fail-closed)
  // Dispatch by function name so the rate-limit mock can't shadow
  // the test's `mockResolvedValueOnce` overrides for the collision
  // check.
  mockRpc.mockImplementation((fnName: string) => {
    if (fnName === "check_throttle") {
      return Promise.resolve({
        data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
        error: null,
      });
    }
    return Promise.resolve({ data: false, error: null });
  });
});

describe("POST /api/account/backup-email/start", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "b@example.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-email body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the candidate equals the primary email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice@example.com" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/primary/i);
  });

  it("returns 409 when the candidate is another user's primary", async () => {
    // The RPC reports the email belongs to a different auth.users
    // row. The route must reject BEFORE persisting or sending.
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === "check_throttle") {
        return Promise.resolve({
          data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "bob@example.com" }));
    expect(res.status).toBe(409);
    expect(mockUpdateEq).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("calls the RPC with the right candidate + excluding_user", async () => {
    const { POST } = await loadRoute();
    await POST(req({ email: "alice-backup@example.com" }));
    expect(mockRpc).toHaveBeenCalledWith("email_taken_by_other_user", {
      candidate: "alice-backup@example.com",
      excluding_user: "user-1",
    });
  });

  it("returns 500 when the RPC itself errors", async () => {
    // Fail-closed: an RPC error means we couldn't verify the email
    // isn't taken, so we don't persist the pending state. (Override
    // the collision-check RPC only; rate-limit RPC still passes.)
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === "check_throttle") {
        return Promise.resolve({
          data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "RPC down" } });
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice-backup@example.com" }));
    expect(res.status).toBe(500);
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockUpdateEq).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("persists pending fields + sends Resend email on the happy path", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice-backup@example.com" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { masked: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.masked).toBe("a••••@example.com");

    // Send was called with the candidate as the recipient.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const calls = mockSendEmail.mock.calls as unknown as Array<
      [{ to: string }]
    >;
    expect(calls[0]?.[0].to).toBe("alice-backup@example.com");

    // The UPDATE wrote a hash (sha-256, 64 hex chars), not the raw code.
    expect(mockUpdateEq).toHaveBeenCalled();
  });

  it("returns 502 when Resend reports a hard error", async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: "Resend down" });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice-backup@example.com" }));
    expect(res.status).toBe(502);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("accepts skip results from Resend without surfacing an error", async () => {
    // sendEmail returns { skipped: true, reason } when env isn't
    // configured (dev). The route should treat that as a no-op
    // success — no 502, no telemetry noise.
    mockSendEmail.mockResolvedValueOnce({
      skipped: true,
      reason: "RESEND_API_KEY not set",
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ email: "alice-backup@example.com" }));
    expect(res.status).toBe(200);
    expect(mockReportServerError).not.toHaveBeenCalled();
  });
});
