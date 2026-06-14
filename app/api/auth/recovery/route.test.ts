import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSupabaseSecretConfig,
  mockSendEmail,
  mockReportServerError,
  mockProfileQuery,
  mockGetUserById,
  mockGenerateLink,
  mockGrantInsert,
} = vi.hoisted(() => ({
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockSendEmail: vi.fn(async () => ({ ok: true, id: "msg-1" })),
  mockReportServerError: vi.fn(async () => {}),
  mockProfileQuery: vi.fn(),
  mockGetUserById: vi.fn(),
  mockGenerateLink: vi.fn(),
  // The recovery grant insert (createRecoveryGrant). Defaults to success.
  mockGrantInsert: vi.fn(
    async (): Promise<{ error: { message: string } | null }> => ({
      error: null,
    }),
  ),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

/** The route makes a chained call:
 *    .from("profiles").select(...).eq("backup_email", ...).not(...).limit(10).returns()
 *  Build a chain that records nothing and returns whatever array the test loaded
 *  into mockProfileQuery (an array of candidate profiles, since a verified
 *  backup can be shared). */
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: { getUserById: mockGetUserById, generateLink: mockGenerateLink },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({ limit: () => ({ returns: mockProfileQuery }) }),
        }),
      }),
      insert: mockGrantInsert,
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.restoreAllMocks();
});

describe("POST /api/auth/recovery", () => {
  it("returns 400 when either address is missing or malformed", async () => {
    const { POST } = await loadRoute();
    expect((await POST(req({}))).status).toBe(400);
    expect(
      (await POST(req({ primaryEmail: "x", backupEmail: "y" }))).status,
    ).toBe(400);
  });

  it("returns 202 on a clean miss (no backup row found)", async () => {
    mockProfileQuery.mockResolvedValue({ data: [], error: null });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);
    // Critically: no Resend send, no generateLink call when the
    // backup row doesn't exist.
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("returns 202 silent miss when backup belongs to a different user", async () => {
    mockProfileQuery.mockResolvedValue({
      data: [{ user_id: "user-2" }],
      error: null,
    });
    mockGetUserById.mockResolvedValueOnce({
      data: { user: { email: "different-primary@example.com" } },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends a magic-link to the backup on a full match", async () => {
    mockProfileQuery.mockResolvedValue({
      data: [{ user_id: "user-1" }],
      error: null,
    });
    mockGetUserById.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alice@example.com" } },
      error: null,
    });
    mockGenerateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hashed-abc" } },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);

    // generateLink was invoked for the PRIMARY email.
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "magiclink",
        email: "alice@example.com",
      }),
    );
    // A single-use recovery grant was minted for the user.
    expect(mockGrantInsert).toHaveBeenCalledTimes(1);
    // The Resend send went to the BACKUP — not the primary.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // The mock isn't typed at the hoisted-declaration site, so
    // TypeScript widens `mock.calls` to `[][]`. Cast the whole
    // calls array to the shape the route uses.
    const calls = mockSendEmail.mock.calls as unknown as Array<
      [{ to: string; html: string }]
    >;
    expect(calls[0]?.[0].to).toBe("alice-bkp@example.com");
    // The link routes through the app's own /auth/confirm handler (reliable
    // session) carrying the token_hash + a next pointing at the step-down.
    const html = calls[0]?.[0].html ?? "";
    expect(html).toContain("/auth/confirm?token_hash=hashed-abc");
    expect(html).toContain("type=magiclink");
    expect(html).toContain("next=");
    // The Supabase-hosted verify URL is NOT used directly anymore.
    expect(html).not.toContain("/auth/v1/verify");
  });

  it("returns 202 (no link sent) when the recovery grant can't be persisted", async () => {
    mockProfileQuery.mockResolvedValue({
      data: [{ user_id: "user-1" }],
      error: null,
    });
    mockGetUserById.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alice@example.com" } },
      error: null,
    });
    mockGenerateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hashed-abc" } },
      error: null,
    });
    mockGrantInsert.mockResolvedValueOnce({ error: { message: "db down" } });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);
    // Fail closed: no dead link emailed, and the failure is logged.
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("disambiguates a SHARED backup by primary email (picks the matching account)", async () => {
    // A verified backup shared by two accounts (a couple). The query returns
    // both; only the one whose primary matches gets the link.
    mockProfileQuery.mockResolvedValue({
      data: [{ user_id: "bob" }, { user_id: "alice" }],
      error: null,
    });
    mockGetUserById.mockImplementation(async (id: string) =>
      id === "alice"
        ? {
            data: { user: { id: "alice", email: "alice@example.com" } },
            error: null,
          }
        : {
            data: { user: { id: "bob", email: "bob@example.com" } },
            error: null,
          },
    );
    mockGenerateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hashed-abc" } },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "shared-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);
    // The link was minted for ALICE's primary (not bob's), even though bob's
    // row came first.
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com" }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("403s on a failed Turnstile BEFORE any profile lookup (configured)", async () => {
    // With Turnstile configured, a bad token must be rejected ahead of the
    // backup lookup — so the 403 is account-independent and leaks nothing.
    process.env.TURNSTILE_SECRET_KEY = "sk_test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
          { status: 200 },
        ),
      );
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
        turnstileToken: "bad",
      }),
    );
    expect(res.status).toBe(403);
    // siteverify was the ONLY network call; no Supabase lookup, no email.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockProfileQuery).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 202 even when generateLink fails (no leak via timing)", async () => {
    mockProfileQuery.mockResolvedValue({
      data: [{ user_id: "user-1" }],
      error: null,
    });
    mockGetUserById.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alice@example.com" } },
      error: null,
    });
    mockGenerateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        primaryEmail: "alice@example.com",
        backupEmail: "alice-bkp@example.com",
      }),
    );
    expect(res.status).toBe(202);
    expect(mockSendEmail).not.toHaveBeenCalled();
    // But the failure IS logged for the operator to see.
    expect(mockReportServerError).toHaveBeenCalled();
  });
});
