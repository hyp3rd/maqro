import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/admin/users/[id]/action — the dispatch
 *  endpoint for ban / unban / trace / untrace / cancel_subscription.
 *
 *  The branches that matter for correctness + security:
 *    - non-admin caller returns the guard response (no work)
 *    - malformed uuid → 400 before any Supabase call
 *    - self-target → 400 (admin can't ban themselves via this path)
 *    - reason required for `ban` + `trace`, optional for the rest
 *    - each action dispatches the right Supabase / Stripe call AND
 *      writes the matching audit row
 *    - cancel_subscription's 404 / 409 / 503 branches */

const VALID_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_ID = "00000000-0000-0000-0000-000000000099";

const {
  mockRequireAdmin,
  mockWriteAuditLog,
  mockReportServerError,
  mockGetStripe,
  mockGetSupabaseSecretConfig,
  mockUpdateUserById,
  mockProfileUpdateEq,
  mockProfileSelectMaybeSingle,
  mockSubsList,
  mockSubsUpdate,
  mockCascadeDelete,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockWriteAuditLog: vi.fn(async () => {}),
  mockReportServerError: vi.fn(async () => {}),
  mockGetStripe: vi.fn(() => ({}) as object | null),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockUpdateUserById: vi.fn(),
  // Cast widens so the error-branch test can override with
  // `{ error: { message } }`.
  mockProfileUpdateEq: vi.fn(
    async () => ({ error: null }) as { error: { message: string } | null },
  ),
  mockProfileSelectMaybeSingle: vi.fn(),
  mockSubsList: vi.fn(),
  mockSubsUpdate: vi.fn(),
  // Mocking the cascade helper here keeps the route test scoped
  // to dispatch + audit-log behaviour. The helper itself has its
  // own coverage in lib/user-deletion.test.ts. Widened return so
  // the error-branch test can override with `{ ok: false, error }`.
  mockCascadeDelete: vi.fn(
    async () => ({ ok: true }) as { ok: true } | { ok: false; error: string },
  ),
}));

vi.mock("@/lib/rbac", () => ({
  requireAdmin: mockRequireAdmin,
  writeAuditLog: mockWriteAuditLog,
}));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/user-deletion", () => ({
  cascadeDeleteUser: mockCascadeDelete,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
    from: () => ({
      // profile select chain (for cancel_subscription)
      select: () => ({
        eq: () => ({ maybeSingle: mockProfileSelectMaybeSingle }),
      }),
      // profile update chain (for trace/untrace)
      update: () => ({ eq: mockProfileUpdateEq }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request(`http://localhost/api/admin/users/${VALID_ID}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: ADMIN_ID });
  mockGetStripe.mockReturnValue({
    subscriptions: { list: mockSubsList, update: mockSubsUpdate },
  });
  mockUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null });
  mockProfileSelectMaybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" },
    error: null,
  });
  mockSubsList.mockResolvedValue({
    data: [{ id: "sub_1", status: "active", cancel_at_period_end: false }],
  });
  mockSubsUpdate.mockResolvedValue({ id: "sub_1", cancel_at_period_end: true });
  mockCascadeDelete.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/users/[id]/action — guards", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban", reason: "x" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res).toBe(forbidden);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-UUID id", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban", reason: "x" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("returns 400 when admin tries to act on their own account", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban", reason: "x" }), {
      params: Promise.resolve({ id: ADMIN_ID }),
    });
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("returns 400 when body isn't JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request(`http://localhost/api/admin/users/${VALID_ID}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
      { params: Promise.resolve({ id: VALID_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on an unknown action", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "delete" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when ban is requested without a reason", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("returns 400 when trace is requested without a reason", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "trace" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(400);
    expect(mockProfileUpdateEq).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users/[id]/action — happy paths", () => {
  it("ban with no duration defaults to 7d (168h)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban", reason: "abuse ticket #42" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith(VALID_ID, {
      ban_duration: "168h",
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.ban",
        targetUserId: VALID_ID,
        adminUserId: ADMIN_ID,
        payload: expect.objectContaining({
          reason: "abuse ticket #42",
          duration: "168h",
          requested: "7d",
        }),
      }),
    );
  });

  it("ban with banDuration='24h' maps to 24h", async () => {
    const { POST } = await loadRoute();
    await POST(req({ action: "ban", reason: "x", banDuration: "24h" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith(VALID_ID, {
      ban_duration: "24h",
    });
  });

  it("ban with banDuration='30d' maps to 720h", async () => {
    const { POST } = await loadRoute();
    await POST(req({ action: "ban", reason: "x", banDuration: "30d" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith(VALID_ID, {
      ban_duration: "720h",
    });
  });

  it("ban with banDuration='permanent' maps to 876000h (not 'forever')", async () => {
    // Supabase's documented 'forever' literal is rejected by
    // updateUserById on current versions — using a 100y interval
    // is the operational workaround. Pin this so we don't drift
    // back to the broken literal.
    const { POST } = await loadRoute();
    await POST(req({ action: "ban", reason: "x", banDuration: "permanent" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith(VALID_ID, {
      ban_duration: "876000h",
    });
  });

  it("unban sets ban_duration=none (no reason required)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "unban" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith(VALID_ID, {
      ban_duration: "none",
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.unban" }),
    );
  });

  it("trace flips profiles.traced=true and writes audit", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ action: "trace", reason: "perf investigation" }),
      { params: Promise.resolve({ id: VALID_ID }) },
    );
    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.trace" }),
    );
    const body = (await res.json()) as { traced: boolean };
    expect(body.traced).toBe(true);
  });

  it("untrace flips profiles.traced=false (no reason required)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "untrace" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traced: boolean };
    expect(body.traced).toBe(false);
  });

  it("cancel_subscription sets cancel_at_period_end on Stripe sub", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "cancel_subscription" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.subscription.cancel",
        payload: expect.objectContaining({
          stripe_subscription_id: "sub_1",
          stripe_customer_id: "cus_1",
        }),
      }),
    );
  });
});

describe("POST /api/admin/users/[id]/action — cancel_subscription error branches", () => {
  it("returns 503 when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "cancel_subscription" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 404 when the user has no Stripe customer", async () => {
    mockProfileSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "cancel_subscription" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(404);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the customer has no subscription", async () => {
    mockSubsList.mockResolvedValueOnce({ data: [] });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "cancel_subscription" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the subscription is already cancelled", async () => {
    mockSubsList.mockResolvedValueOnce({
      data: [{ id: "sub_x", status: "canceled", cancel_at_period_end: true }],
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "cancel_subscription" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(409);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users/[id]/action — delete_user", () => {
  it("rejects when no reason is supplied", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "delete_user" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(400);
    expect(mockCascadeDelete).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("blocks an admin from deleting their own account via this path", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ action: "delete_user", reason: "self-destruct" }),
      { params: Promise.resolve({ id: ADMIN_ID }) },
    );
    expect(res.status).toBe(400);
    expect(mockCascadeDelete).not.toHaveBeenCalled();
  });

  it("audits then runs the cascade on the happy path", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ action: "delete_user", reason: "GDPR erasure ticket #99" }),
      { params: Promise.resolve({ id: VALID_ID }) },
    );
    expect(res.status).toBe(200);
    // Audit row first — written BEFORE the destructive call so the
    // "who did what, why" record survives even if the cascade
    // half-fails and the user can't be re-introspected afterwards.
    const auditCallOrder = mockWriteAuditLog.mock.invocationCallOrder[0] ?? 0;
    const cascadeCallOrder = mockCascadeDelete.mock.invocationCallOrder[0] ?? 0;
    expect(auditCallOrder).toBeLessThan(cascadeCallOrder);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.delete",
        targetUserId: VALID_ID,
        adminUserId: ADMIN_ID,
        payload: expect.objectContaining({ reason: "GDPR erasure ticket #99" }),
      }),
    );
    expect(mockCascadeDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: VALID_ID,
        callerRoute: "/api/admin/users/[id]/action",
      }),
    );
  });

  it("returns 500 + preserves audit row when the cascade fails", async () => {
    mockCascadeDelete.mockResolvedValueOnce({
      ok: false,
      error: "auth.admin.deleteUser denied",
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "delete_user", reason: "abuse" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("auth.admin.deleteUser denied");
    // Audit row still written — operator-visible record of the
    // attempt is more important than the destructive call landing.
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.delete" }),
    );
  });
});

describe("POST /api/admin/users/[id]/action — Supabase error propagation", () => {
  it("returns 500 + reports when updateUserById fails on ban", async () => {
    mockUpdateUserById.mockResolvedValueOnce({
      data: null,
      error: { message: "auth.admin denied" },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "ban", reason: "x" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(500);
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 500 + reports when profile update fails on trace", async () => {
    mockProfileUpdateEq.mockResolvedValueOnce({
      error: { message: "RLS denied" },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ action: "trace", reason: "x" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(500);
    expect(mockReportServerError).toHaveBeenCalled();
  });
});
