import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/admin/inbox/send — the admin-issued outbound
 *  email surface. Validation is strict (recipient shape,
 *  scheduled-window bounds, body required) so the bulk of the
 *  coverage here is on rejecting malformed inputs before any
 *  Resend / Supabase call lands. Happy paths assert the audit row
 *  + persist-to-DB hook fired with the expected payload. */

const {
  mockRequireAdmin,
  mockSendAdminEmail,
  mockWriteAuditLog,
  mockGetSupabaseSecretConfig,
  mockReportServerError,
  mockInsert,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  // Widened so per-test overrides can return error shapes.
  mockSendAdminEmail: vi.fn() as ReturnType<typeof vi.fn>,
  mockWriteAuditLog: vi.fn(async () => {}),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockReportServerError: vi.fn(async () => {}),
  // Default: insert succeeds. Tests override to simulate persist
  // failure or to capture the row payload.
  mockInsert: vi.fn(async () => ({ error: null })) as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/email/sending", () => ({ sendAdminEmail: mockSendAdminEmail }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => ({ insert: mockInsert }) })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/admin/inbox/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockSendAdminEmail.mockResolvedValue({ ok: true, id: "em_xyz" });
  mockInsert.mockResolvedValue({ error: null });
});

describe("POST /api/admin/inbox/send — guards", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "y" }));
    expect(res).toBe(forbidden);
    expect(mockSendAdminEmail).not.toHaveBeenCalled();
  });

  it("returns 400 on non-JSON body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: "not-json{",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/inbox/send — validation", () => {
  it("rejects empty `to` array", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ to: [], subject: "x", text: "y" }));
    expect(res.status).toBe(400);
    expect(mockSendAdminEmail).not.toHaveBeenCalled();
  });

  it("rejects non-string entries in `to`", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ to: ["a@b.com", 42], subject: "x", text: "y" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed recipient emails", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ to: ["not-an-email"], subject: "x", text: "y" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects more than 25 recipients", async () => {
    const many = Array.from({ length: 26 }, (_, i) => `u${i}@example.com`);
    const { POST } = await loadRoute();
    const res = await POST(req({ to: many, subject: "x", text: "y" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing subject", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], text: "y" }));
    expect(res.status).toBe(400);
  });

  it("rejects empty text body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects scheduledAt in the past", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { POST } = await loadRoute();
    const res = await POST(
      req({ to: ["a@b.com"], subject: "x", text: "y", scheduledAt: past }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects scheduledAt more than 30 days out", async () => {
    const tooFar = new Date(
      Date.now() + 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { POST } = await loadRoute();
    const res = await POST(
      req({ to: ["a@b.com"], subject: "x", text: "y", scheduledAt: tooFar }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unparseable scheduledAt", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        to: ["a@b.com"],
        subject: "x",
        text: "y",
        scheduledAt: "not-a-date",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/inbox/send — Resend error propagation", () => {
  it("503s when Resend isn't configured", async () => {
    mockSendAdminEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "not-configured" },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "y" }));
    expect(res.status).toBe(503);
  });

  it("503s when EMAIL_FROM isn't configured", async () => {
    mockSendAdminEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "no-sender" },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "y" }));
    expect(res.status).toBe(503);
  });

  it("502s + reports on Resend api-error", async () => {
    mockSendAdminEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "api-error", message: "Resend 422: invalid sender" },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "y" }));
    expect(res.status).toBe(502);
    expect(mockReportServerError).toHaveBeenCalled();
  });
});

describe("POST /api/admin/inbox/send — happy path", () => {
  it("sends, persists, audits, and returns the Resend id", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ to: ["alice@example.com"], subject: "hi", text: "body" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      id: string;
      persisted: boolean;
    };
    expect(body).toMatchObject({ ok: true, id: "em_xyz", persisted: true });
    expect(mockSendAdminEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["alice@example.com"],
        subject: "hi",
        text: "body",
      }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "em_xyz",
        admin_user_id: "admin-1",
        recipients: ["alice@example.com"],
        subject: "hi",
        in_reply_to: null,
        scheduled_at: null,
      }),
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.send",
        adminUserId: "admin-1",
        payload: expect.objectContaining({
          resendId: "em_xyz",
          to: ["alice@example.com"],
          persisted: true,
        }),
      }),
    );
  });

  it("logs the reply action when inReplyTo is set", async () => {
    const { POST } = await loadRoute();
    await POST(
      req({
        to: ["alice@example.com"],
        subject: "Re: hi",
        text: "thanks!",
        inReplyTo: "em_inbound_1",
      }),
    );
    expect(mockSendAdminEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: "em_inbound_1" }),
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.reply",
        payload: expect.objectContaining({ inReplyTo: "em_inbound_1" }),
      }),
    );
  });

  it("returns success + persisted:false when DB insert fails (send already shipped)", async () => {
    // Once Resend has accepted the message, undoing it is no longer
    // possible. The DB row is a convenience — its absence shouldn't
    // mask the successful send. Surface the persistence failure via
    // the flag so the operator knows the Outgoing list won't show it.
    mockInsert.mockResolvedValueOnce({ error: { message: "rls denied" } });
    const { POST } = await loadRoute();
    const res = await POST(req({ to: ["a@b.com"], subject: "x", text: "y" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persisted: boolean };
    expect(body.persisted).toBe(false);
    expect(mockReportServerError).toHaveBeenCalled();
  });
});
