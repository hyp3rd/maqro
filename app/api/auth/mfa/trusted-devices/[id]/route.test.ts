import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for DELETE /api/auth/mfa/trusted-devices/[id] — single-row
 *  revoke. The interesting branches are missing-session (401) and
 *  ensuring the delete is scoped to user_id (belt-and-braces over
 *  RLS, mirroring the parent route). The route deliberately does
 *  not 404 on a missing row — that's a documented behavior and we
 *  assert it. */

const { mockGetSupabaseServer, mockDeleteEqId } = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  // Cast widens the inferred return so the error-branch test
  // can override with `{ error: { message } }`.
  mockDeleteEqId: vi.fn(
    async () => ({ error: null }) as { error: { message: string } | null },
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

const reqStub = new Request(
  "http://localhost/api/auth/mfa/trusted-devices/trust-1",
);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({ delete: () => ({ eq: () => ({ eq: mockDeleteEqId }) }) }),
  });
  mockDeleteEqId.mockResolvedValue({ error: null });
});

describe("DELETE /api/auth/mfa/trusted-devices/[id]", () => {
  it("returns 503 when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, {
      params: Promise.resolve({ id: "trust-1" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, {
      params: Promise.resolve({ id: "trust-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is empty", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, { params: Promise.resolve({ id: "" }) });
    expect(res.status).toBe(400);
  });

  it("returns 204 on success", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, {
      params: Promise.resolve({ id: "trust-1" }),
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("returns 204 even when the row does not exist (idempotent)", async () => {
    // Supabase DELETE returns no error when no rows match — we treat
    // that as success rather than 404. Asserting this so a future
    // refactor doesn't accidentally introduce a row-count check.
    mockDeleteEqId.mockResolvedValueOnce({ error: null });
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(res.status).toBe(204);
  });

  it("returns 500 on delete error", async () => {
    mockDeleteEqId.mockResolvedValueOnce({
      error: { message: "permission denied" },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE(reqStub, {
      params: Promise.resolve({ id: "trust-1" }),
    });
    expect(res.status).toBe(500);
  });
});
