import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for GET /api/admin/users/[id] — single-user detail. The
 *  load-bearing branches: auth gate, malformed id (400 before any
 *  Supabase round-trip), user-not-found (404), and the happy path
 *  where the response includes the four merged data sources
 *  (auth.users core, profile, Stripe subscription, recent
 *  audit-log rows). Stripe-side failures degrade to
 *  subscription:null rather than 500 — the operator can still
 *  ban / trace / change role even if Stripe is hiccuping. */

const VALID_ID = "00000000-0000-0000-0000-000000000001";

const {
  mockRequireAdmin,
  mockGetStripe,
  mockGetSupabaseSecretConfig,
  mockGetUserById,
  mockProfileMaybeSingle,
  mockSubsList,
  mockAuditLogChain,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetStripe: vi.fn(() => ({}) as object | null),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockGetUserById: vi.fn(),
  mockProfileMaybeSingle: vi.fn(),
  mockSubsList: vi.fn(),
  // Captures the chained admin_audit_log SELECT — the inner
  // `.limit(10)` resolves to a Promise.
  mockAuditLogChain: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { getUserById: mockGetUserById } },
    // `from` is called for profile (single chain) and for
    // admin_audit_log (different chain — select → eq → order →
    // limit). Dispatch by table name.
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mockProfileMaybeSingle }),
          }),
        };
      }
      // admin_audit_log
      return {
        select: () => ({
          eq: () => ({ order: () => ({ limit: mockAuditLogChain }) }),
        }),
      };
    },
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

const reqStub = new Request(`http://localhost/api/admin/users/${VALID_ID}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ ok: true, userId: "admin-1" });
  mockGetStripe.mockReturnValue({ subscriptions: { list: mockSubsList } });
  mockGetUserById.mockResolvedValue({
    data: {
      user: {
        id: VALID_ID,
        email: "u@example.com",
        created_at: "2026-05-01T00:00:00Z",
        last_sign_in_at: "2026-05-20T00:00:00Z",
        banned_until: null,
      },
    },
    error: null,
  });
  mockProfileMaybeSingle.mockResolvedValue({
    data: {
      role: "user",
      is_premium: true,
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      traced: false,
    },
    error: null,
  });
  mockSubsList.mockResolvedValue({
    data: [
      {
        id: "sub_1",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              current_period_end: 1735689600,
              price: { nickname: "Plus monthly" },
            },
          ],
        },
      },
    ],
  });
  mockAuditLogChain.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/admin/users/[id]", () => {
  it("returns the guard response when caller isn't admin", async () => {
    const forbidden = new Response("forbidden", { status: 403 });
    mockRequireAdmin.mockResolvedValueOnce({ ok: false, response: forbidden });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res).toBe(forbidden);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-UUID id", async () => {
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when the service-role key isn't configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 404 when getUserById has no user", async () => {
    mockGetUserById.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the merged detail shape on the happy path", async () => {
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      email: string;
      role: string;
      isPremium: boolean;
      traced: boolean;
      subscription: { id: string; planLabel: string } | null;
      recentActions: unknown[];
    };
    expect(body.id).toBe(VALID_ID);
    expect(body.email).toBe("u@example.com");
    expect(body.role).toBe("user");
    expect(body.isPremium).toBe(true);
    expect(body.traced).toBe(false);
    expect(body.subscription?.id).toBe("sub_1");
    expect(body.subscription?.planLabel).toBe("Plus monthly");
    expect(body.recentActions).toEqual([]);
  });

  it("degrades subscription to null on a Stripe failure (doesn't 500)", async () => {
    // A Stripe outage shouldn't prevent the admin from seeing the
    // user — they need to be able to ban / trace regardless.
    mockSubsList.mockRejectedValueOnce(new Error("stripe network err"));
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: unknown };
    expect(body.subscription).toBeNull();
  });

  it("returns subscription:null when the user has no Stripe customer", async () => {
    mockProfileMaybeSingle.mockResolvedValueOnce({
      data: {
        role: "user",
        is_premium: false,
        subscription_status: null,
        stripe_customer_id: null,
        traced: false,
      },
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: unknown };
    expect(body.subscription).toBeNull();
    expect(mockSubsList).not.toHaveBeenCalled();
  });

  it("exposes the banned_until field when set", async () => {
    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: VALID_ID,
          email: "u@example.com",
          created_at: "2026-05-01T00:00:00Z",
          last_sign_in_at: null,
          banned_until: "infinity",
        },
      },
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    const body = (await res.json()) as { bannedUntil: string };
    expect(body.bannedUntil).toBe("infinity");
  });

  it("includes recent audit-log actions when present", async () => {
    mockAuditLogChain.mockResolvedValueOnce({
      data: [
        {
          id: "audit_1",
          created_at: "2026-05-22T00:00:00Z",
          action: "user.ban",
          admin_user_id: "admin-1",
          payload: { reason: "spam" },
        },
      ],
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET(reqStub, {
      params: Promise.resolve({ id: VALID_ID }),
    });
    const body = (await res.json()) as {
      recentActions: Array<{ id: string; action: string }>;
    };
    expect(body.recentActions.length).toBe(1);
    expect(body.recentActions[0]?.action).toBe("user.ban");
  });
});
