import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST/DELETE /api/admin/inbox/[id]/dismiss — archive an inbound
 *  message and the symmetric un-archive that backs the inbox's Undo. The audit
 *  log fires on every attempt (success or failure) so the trail brackets both
 *  directions. */

const {
  mockRequireAdmin,
  mockWriteAuditLog,
  mockDismissEmail,
  mockUndismissEmail,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockWriteAuditLog: vi.fn(async () => {}),
  mockDismissEmail: vi.fn() as ReturnType<typeof vi.fn>,
  mockUndismissEmail: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/email/dismissed", () => ({
  dismissEmail: mockDismissEmail,
  undismissEmail: mockUndismissEmail,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockDismissEmail.mockResolvedValue({ ok: true });
  mockUndismissEmail.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/inbox/[id]/dismiss", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res).toBe(forbidden);
    expect(mockDismissEmail).not.toHaveBeenCalled();
  });

  it("archives + audits on success", async () => {
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(200);
    expect(mockDismissEmail).toHaveBeenCalledWith("em_x", "admin-1");
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.dismiss",
        payload: expect.objectContaining({ emailId: "em_x", ok: true }),
      }),
    );
  });

  it("returns 500 + audits the failure when the write fails", async () => {
    mockDismissEmail.mockResolvedValueOnce({ ok: false, error: "boom" });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(500);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.dismiss",
        payload: expect.objectContaining({ ok: false, error: "boom" }),
      }),
    );
  });
});

describe("DELETE /api/admin/inbox/[id]/dismiss", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { DELETE } = await loadRoute();
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res).toBe(forbidden);
    expect(mockUndismissEmail).not.toHaveBeenCalled();
  });

  it("un-archives + audits on success", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(200);
    expect(mockUndismissEmail).toHaveBeenCalledWith("em_x");
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.undismiss",
        payload: expect.objectContaining({ emailId: "em_x", ok: true }),
      }),
    );
  });

  it("returns 500 + audits the failure when the delete fails", async () => {
    mockUndismissEmail.mockResolvedValueOnce({ ok: false, error: "boom" });
    const { DELETE } = await loadRoute();
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "em_x" }),
    });
    expect(res.status).toBe(500);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbox.undismiss",
        payload: expect.objectContaining({ ok: false, error: "boom" }),
      }),
    );
  });
});
