import { beforeEach, describe, expect, it, vi } from "vitest";

/** Hoisted mocks. Vitest hoists `vi.mock()` calls above imports, so
 *  hoisted spies are how we keep them addressable from inside the
 *  factories below. */
const {
  mockAuthGetUser,
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockGetStripe,
  mockReportServerError,
  mockAdminDeleteUser,
  mockProfileSingle,
  mockStorageList,
  mockStorageRemove,
  mockSubscriptionsList,
  mockSubscriptionsCancel,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockAuthGetUser: vi.fn(),
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(),
  mockGetStripe: vi.fn(),
  mockReportServerError: vi.fn(async () => {}),
  mockAdminDeleteUser: vi.fn(),
  mockProfileSingle: vi.fn(),
  mockStorageList: vi.fn(),
  mockStorageRemove: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsCancel: vi.fn(),
  // Widened return type so per-test overrides can return the
  // error or skip shapes from lib/email/resend without TS narrowing
  // the mock to the happy-path-only signature.
  mockSendEmail: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { deleteUser: mockAdminDeleteUser } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockProfileSingle }) }),
    }),
    storage: {
      from: () => ({ list: mockStorageList, remove: mockStorageRemove }),
    },
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));

vi.mock("@/lib/billing/stripe", () => ({ getStripe: mockGetStripe }));

vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));

vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));

/** Re-import the route fresh in each test so mock changes propagate
 *  through the createClient factory. */
async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ ok: true, id: "msg-1" });
  mockGetSupabaseServer.mockResolvedValue({
    auth: { getUser: mockAuthGetUser },
  });
  mockAuthGetUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "u@example.com" } },
    error: null,
  });
  mockGetSupabaseSecretConfig.mockReturnValue({
    url: "https://test.supabase.co",
    secretKey: "sb_secret_x",
  });
  mockGetStripe.mockReturnValue(null);
  mockProfileSingle.mockResolvedValue({ data: null, error: null });
  mockStorageList.mockResolvedValue({ data: [], error: null });
  mockStorageRemove.mockResolvedValue({ error: null });
  mockAdminDeleteUser.mockResolvedValue({ error: null });
});

describe("POST /api/delete-account — guard rails", () => {
  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(503);
  });

  it("returns 401 when no session", async () => {
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });

  it("returns 503 when service-role key is missing", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(503);
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/delete-account — happy path", () => {
  it("calls auth.admin.deleteUser and returns 204", async () => {
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(mockAdminDeleteUser).toHaveBeenCalledWith("user-1");
  });

  it("skips Stripe entirely when getStripe returns null", async () => {
    const { POST } = await loadRoute();
    await POST();
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("skips Stripe when the user has no customer id", async () => {
    mockGetStripe.mockReturnValue({
      subscriptions: {
        list: mockSubscriptionsList,
        cancel: mockSubscriptionsCancel,
      },
    });
    mockProfileSingle.mockResolvedValue({
      data: { stripe_customer_id: null },
      error: null,
    });
    const { POST } = await loadRoute();
    await POST();
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
  });
});

describe("POST /api/delete-account — Stripe cascade", () => {
  beforeEach(() => {
    mockGetStripe.mockReturnValue({
      subscriptions: {
        list: mockSubscriptionsList,
        cancel: mockSubscriptionsCancel,
      },
    });
    mockProfileSingle.mockResolvedValue({
      data: { stripe_customer_id: "cus_abc" },
      error: null,
    });
  });

  it("cancels every non-terminal subscription on the customer", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [
        { id: "sub_active", status: "active" },
        { id: "sub_trial", status: "trialing" },
        { id: "sub_canceled", status: "canceled" }, // skip
        { id: "sub_expired", status: "incomplete_expired" }, // skip
        { id: "sub_pastdue", status: "past_due" },
      ],
    });
    mockSubscriptionsCancel.mockResolvedValue({});

    const { POST } = await loadRoute();
    const res = await POST();

    expect(res.status).toBe(204);
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(3);
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_active", {
      prorate: false,
    });
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_trial", {
      prorate: false,
    });
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_pastdue", {
      prorate: false,
    });
  });

  it("logs and continues when a single cancel fails", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [
        { id: "sub_a", status: "active" },
        { id: "sub_b", status: "active" },
      ],
    });
    mockSubscriptionsCancel
      .mockRejectedValueOnce(new Error("Stripe down"))
      .mockResolvedValueOnce({});

    const { POST } = await loadRoute();
    const res = await POST();

    expect(res.status).toBe(204);
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(2);
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockAdminDeleteUser).toHaveBeenCalled(); // still ran
  });

  it("does not block deletion when Stripe.list itself fails", async () => {
    mockSubscriptionsList.mockRejectedValue(new Error("network"));
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockAdminDeleteUser).toHaveBeenCalled();
  });
});

describe("POST /api/delete-account — storage cascade", () => {
  it("removes every object under the user's prefix in exports", async () => {
    mockStorageList.mockResolvedValue({
      data: [{ name: "2025-01-01.json" }, { name: "2025-02-01.json" }],
      error: null,
    });

    const { POST } = await loadRoute();
    await POST();

    expect(mockStorageRemove).toHaveBeenCalledWith([
      "user-1/2025-01-01.json",
      "user-1/2025-02-01.json",
    ]);
  });

  it("skips remove when the listing is empty", async () => {
    mockStorageList.mockResolvedValue({ data: [], error: null });
    const { POST } = await loadRoute();
    await POST();
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it("logs and continues when storage list errors", async () => {
    mockStorageList.mockResolvedValue({
      data: null,
      error: { message: "bucket missing" },
    });
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockAdminDeleteUser).toHaveBeenCalled();
  });

  it("logs and continues when storage remove errors", async () => {
    mockStorageList.mockResolvedValue({
      data: [{ name: "f.json" }],
      error: null,
    });
    mockStorageRemove.mockResolvedValue({ error: { message: "denied" } });
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(mockReportServerError).toHaveBeenCalled();
    expect(mockAdminDeleteUser).toHaveBeenCalled();
  });
});

describe("POST /api/delete-account — auth delete failure", () => {
  it("returns 500 and logs when auth.admin.deleteUser fails", async () => {
    mockAdminDeleteUser.mockResolvedValue({
      error: { message: "Service unavailable" },
    });
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Service unavailable/);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("does not send the confirmation email if the deletion failed", async () => {
    mockAdminDeleteUser.mockResolvedValue({
      error: { message: "Service unavailable" },
    });
    const { POST } = await loadRoute();
    await POST();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/delete-account — confirmation email", () => {
  it("sends the account-deleted email to the user's address after a successful deletion", async () => {
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [call] = mockSendEmail.mock.calls as unknown as Array<
      [{ to: string; subject: string }]
    >;
    expect(call?.[0].to).toBe("u@example.com");
    expect(call?.[0].subject).toMatch(/deleted/i);
  });

  it("logs (but doesn't fail the request) when the email send errors", async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: "Resend down" });
    const { POST } = await loadRoute();
    const res = await POST();
    // Deletion already succeeded; we don't reverse a destructive
    // action just because the receipt didn't ship.
    expect(res.status).toBe(204);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("skips the email step when the user record had no email", async () => {
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: null } },
      error: null,
    });
    const { POST } = await loadRoute();
    await POST();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
