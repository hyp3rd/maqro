import { beforeEach, describe, expect, it, vi } from "vitest";

/** PATCH /api/admin/users/[id]/role. The role lives on the user's profiles
 *  row: the change is a checked UPDATE that must match that row. The old
 *  payload-less upsert always failed with 23502 (payload is NOT NULL, and
 *  Postgres checks that on the proposed row before ON CONFLICT). */

const VALID_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000099";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  writeAuditLog: vi.fn(async () => {}),
  roleRead: vi.fn(),
  roleUpdate: vi.fn(),
  updates: [] as unknown[],
  upsert: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: h.requireAdmin,
  writeAuditLog: h.writeAuditLog,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "http://supabase.test",
    secretKey: "service-role",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.roleRead }) }),
      update: (patch: unknown) => {
        h.updates.push(patch);
        return { eq: () => ({ select: h.roleUpdate }) };
      },
      upsert: h.upsert,
    }),
  }),
}));

const { PATCH } = await import("./route");

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/admin/users/${id}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.requireAdmin.mockResolvedValue({ ok: true, userId: ADMIN_ID });
  h.roleRead.mockResolvedValue({ data: { role: "user" }, error: null });
  h.roleUpdate.mockResolvedValue({
    data: [{ user_id: VALID_ID }],
    error: null,
  });
});

describe("PATCH /api/admin/users/[id]/role", () => {
  it("promotes with a checked UPDATE and audits the change", async () => {
    const res = await patch(VALID_ID, { role: "admin" });

    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ role: "admin" }]);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.set",
        targetUserId: VALID_ID,
        payload: { from: "user", to: "admin" },
      }),
    );
  });

  it("returns 404 without auditing when no profile row matched", async () => {
    h.roleRead.mockResolvedValue({ data: null, error: null });
    h.roleUpdate.mockResolvedValue({ data: [], error: null });

    const res = await patch(VALID_ID, { role: "admin" });

    expect(res.status).toBe(404);
    expect(h.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 500 without auditing when the update fails", async () => {
    h.roleUpdate.mockResolvedValue({
      data: null,
      error: { message: "statement timeout" },
    });

    const res = await patch(VALID_ID, { role: "admin" });

    expect(res.status).toBe(500);
    expect(h.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 500 when the current role can't be read", async () => {
    h.roleRead.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    const res = await patch(VALID_ID, { role: "admin" });

    expect(res.status).toBe(500);
    expect(h.updates).toEqual([]);
  });

  it("rejects a malformed user id", async () => {
    const res = await patch("not-a-uuid", { role: "admin" });

    expect(res.status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it("still refuses self-demotion", async () => {
    const res = await patch(ADMIN_ID, { role: "user" });

    expect(res.status).toBe(400);
    expect(h.updates).toEqual([]);
  });
});
