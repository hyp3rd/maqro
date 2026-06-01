import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAdmin, mockWriteAuditLog, mockGetSetting, mockSetSetting } =
  vi.hoisted(() => ({
    mockRequireAdmin: vi.fn(),
    mockWriteAuditLog: vi.fn(async () => {}),
    mockGetSetting: vi.fn() as ReturnType<typeof vi.fn>,
    mockSetSetting: vi.fn() as ReturnType<typeof vi.fn>,
  }));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/app-settings", () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  SETTING_KEYS: { supportInbox: "support_inbox" },
  SETTING_DEFAULTS: { support_inbox: "support@maqro.app" },
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockGetSetting.mockResolvedValue("support@maqro.app");
  mockSetSetting.mockResolvedValue({ ok: true });
});

describe("GET /api/admin/settings", () => {
  it("403s for non-admins", async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response("nope", { status: 403 }),
    });
    const { GET } = await loadRoute();
    expect((await GET()).status).toBe(403);
  });

  it("returns the current value of every whitelisted setting", async () => {
    const { GET } = await loadRoute();
    const res = await GET();
    const body = (await res.json()) as { settings: Record<string, string> };
    expect(body.settings.support_inbox).toBe("support@maqro.app");
  });
});

describe("POST /api/admin/settings", () => {
  it("403s for non-admins", async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response("nope", { status: 403 }),
    });
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({ key: "support_inbox", value: "x@example.com" }),
    );
    expect(res.status).toBe(403);
  });

  it("400s for unknown keys (whitelist)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq({ key: "evil_setting", value: "anything" }));
    expect(res.status).toBe(400);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("400s when value is empty / blank", async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq({ key: "support_inbox", value: "   " }));
    expect(res.status).toBe(400);
  });

  it("400s when support_inbox isn't a valid email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({ key: "support_inbox", value: "not-an-email" }),
    );
    expect(res.status).toBe(400);
  });

  it("204s on a valid email + writes an audit row", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({ key: "support_inbox", value: "ops@example.com" }),
    );
    expect(res.status).toBe(204);
    expect(mockSetSetting).toHaveBeenCalledWith({
      key: "support_inbox",
      value: "ops@example.com",
      updatedBy: "admin-1",
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "settings.update" }),
    );
  });

  it("500s when the underlying setSetting reports an error", async () => {
    mockSetSetting.mockResolvedValueOnce({ ok: false, error: "DB down" });
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({ key: "support_inbox", value: "ops@example.com" }),
    );
    expect(res.status).toBe(500);
  });
});
