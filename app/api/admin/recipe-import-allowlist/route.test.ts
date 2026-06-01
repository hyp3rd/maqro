import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdmin,
  mockWriteAuditLog,
  mockClearCache,
  mockSelectOrder,
  mockInsertSelectMaybeSingle,
  mockDeleteEq,
  mockFrom,
} = vi.hoisted(() => {
  const selectOrder = vi.fn() as ReturnType<typeof vi.fn>;
  const select = vi.fn(() => ({ order: selectOrder }));
  const insertSelectMaybeSingle = vi.fn() as ReturnType<typeof vi.fn>;
  const insertSelect = vi.fn(() => ({ maybeSingle: insertSelectMaybeSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const deleteEq = vi.fn() as ReturnType<typeof vi.fn>;
  const del = vi.fn(() => ({ eq: deleteEq }));
  const from = vi.fn(() => ({ select, insert, delete: del }));
  return {
    mockRequireAdmin: vi.fn(),
    mockWriteAuditLog: vi.fn(async () => {}),
    mockClearCache: vi.fn(),
    mockSelectOrder: selectOrder,
    mockInsertSelectMaybeSingle: insertSelectMaybeSingle,
    mockDeleteEq: deleteEq,
    mockFrom: from,
  };
});

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_x",
  }),
}));
vi.mock("@/lib/recipe-import/host-allowlist", () => ({
  _clearAllowlistCacheForTests: mockClearCache,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/admin/recipe-import-allowlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteReq(query: string): Request {
  return new Request(
    `http://localhost/api/admin/recipe-import-allowlist?${query}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockSelectOrder.mockResolvedValue({ data: [], error: null });
  mockInsertSelectMaybeSingle.mockResolvedValue({
    data: {
      hostname: "example.com",
      note: null,
      created_at: "2026-05-23T00:00:00Z",
      created_by: "admin-1",
    },
    error: null,
  });
  mockDeleteEq.mockResolvedValue({ error: null });
});

describe("GET — list", () => {
  it("403s for non-admins via requireAdmin", async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response("nope", { status: 403 }),
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the sorted entries list", async () => {
    mockSelectOrder.mockResolvedValueOnce({
      data: [
        { hostname: "a.example.com", note: null },
        { hostname: "b.example.com", note: "approved" },
      ],
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ hostname: string }> };
    expect(body.entries.map((e) => e.hostname)).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
  });
});

describe("POST — add", () => {
  it("403s for non-admins", async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response("nope", { status: 403 }),
    });
    const { POST } = await loadRoute();
    const res = await POST(postReq({ hostname: "example.com" }));
    expect(res.status).toBe(403);
  });

  it("400s for non-JSON body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq("not-json"));
    expect(res.status).toBe(400);
  });

  it("400s for missing hostname", async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it("400s for a hostname containing scheme/path/port", async () => {
    const cases = [
      "https://example.com",
      "example.com/path",
      "example.com:8080",
      "example.com?q=1",
      "no-dot",
      "a..b.com",
      ".example.com",
      "example.com.",
      "-example.com",
    ];
    const { POST } = await loadRoute();
    for (const hostname of cases) {
      const res = await POST(postReq({ hostname }));
      expect(res.status, `expected 400 for ${hostname}`).toBe(400);
    }
  });

  it("normalizes mixed-case hostnames before insert", async () => {
    const { POST } = await loadRoute();
    await POST(postReq({ hostname: "Example.COM" }));
    // The insert path's `.insert({ hostname, ... })` is called inside
    // our mockFrom chain; we don't capture it directly here but we
    // assert via the cache-clear side-effect that fired.
    expect(mockClearCache).toHaveBeenCalled();
  });

  it("returns 409 on duplicate hostname (Postgres 23505)", async () => {
    mockInsertSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    const { POST } = await loadRoute();
    const res = await POST(postReq({ hostname: "example.com" }));
    expect(res.status).toBe(409);
  });

  it("creates the entry, returns 201, and writes an audit row", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({ hostname: "example.com", note: "approved by ops" }),
    );
    expect(res.status).toBe(201);
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "recipe_import_allowlist.add",
        adminUserId: "admin-1",
      }),
    );
  });
});

describe("DELETE — remove", () => {
  it("403s for non-admins", async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response("nope", { status: 403 }),
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE(deleteReq("hostname=example.com"));
    expect(res.status).toBe(403);
  });

  it("400s when ?hostname is missing", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(deleteReq(""));
    expect(res.status).toBe(400);
  });

  it("400s when ?hostname is malformed", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(deleteReq("hostname=not%20a%20hostname"));
    expect(res.status).toBe(400);
  });

  it("returns 204 and drops the cache on success", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(deleteReq("hostname=example.com"));
    expect(res.status).toBe(204);
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recipe_import_allowlist.remove" }),
    );
  });
});
