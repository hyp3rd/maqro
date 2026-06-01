import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/admin/inbox/outgoing/[id]/cancel — wraps
 *  Resend's cancel-scheduled surface. The audit log fires on EVERY
 *  attempt (success or failure) so the post-hoc "did the operator
 *  click cancel before it shipped?" question always has a record. */

const {
  mockRequireAdmin,
  mockWriteAuditLog,
  mockCancelOutgoingEmail,
  mockReportServerError,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockWriteAuditLog: vi.fn(async () => {}),
  // Widened so per-test overrides can return error shapes.
  mockCancelOutgoingEmail: vi.fn() as ReturnType<typeof vi.fn>,
  mockReportServerError: vi.fn(async () => {}),
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/email/sending", () => ({
  cancelOutgoingEmail: mockCancelOutgoingEmail,
}));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockCancelOutgoingEmail.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/inbox/outgoing/[id]/cancel", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res).toBe(forbidden);
    expect(mockCancelOutgoingEmail).not.toHaveBeenCalled();
  });

  it("returns 400 on empty id", async () => {
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when Resend isn't configured", async () => {
    mockCancelOutgoingEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "not-configured" },
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(503);
    // Audit fires even on a 503 — the operator-visible action is
    // the attempt, not the outcome.
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inbox.cancel" }),
    );
  });

  it("returns 404 when Resend can't find the id", async () => {
    mockCancelOutgoingEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "not-found" },
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 502 + reports on Resend api-error", async () => {
    mockCancelOutgoingEmail.mockResolvedValueOnce({
      ok: false,
      error: { kind: "api-error", message: "already sent" },
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(502);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("returns 200 + audits on successful cancel", async () => {
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.cancel",
        payload: expect.objectContaining({ resendId: "em_x", ok: true }),
      }),
    );
  });
});
