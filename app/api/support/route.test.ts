import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSupabaseServer, mockSendEmail, mockReportServerError, mockRpc } =
  vi.hoisted(() => ({
    mockGetSupabaseServer: vi.fn(),
    mockSendEmail: vi.fn() as ReturnType<typeof vi.fn>,
    mockReportServerError: vi.fn(async () => {}),
    // Default mock — check_throttle returns allowed.
    mockRpc: vi.fn(async () => ({
      data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
      error: null,
    })),
  }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));
vi.mock("@/lib/app-settings", () => ({
  // Force the route to use a known address so we can assert routing
  // without exercising the real Supabase-backed getSetting.
  getSetting: vi.fn(async () => "support@maqro.app"),
  SETTING_KEYS: { supportInbox: "support_inbox" },
  SETTING_DEFAULTS: { support_inbox: "support@maqro.app" },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mockRpc })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown, init?: { ua?: string }): Request {
  return new Request("http://localhost/api/support", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.ua ? { "User-Agent": init.ua } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock state: anonymous user (no Supabase session).
  mockGetSupabaseServer.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  });
  mockSendEmail.mockResolvedValue({ ok: true, id: "msg-1" });
  mockRpc.mockResolvedValue({
    data: [{ allowed: true, count: 1, retry_after_seconds: 0 }],
    error: null,
  });
});

describe("POST /api/support — validation", () => {
  it("returns 400 when body is not JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req("not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects an empty subject", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "",
        body: "Long enough message here.",
        email: "u@example.com",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a too-short body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({ subject: "Hi", body: "short", email: "u@example.com" }),
    );
    expect(res.status).toBe(400);
  });

  it("requires email when the caller is not authenticated", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Question",
        body: "A long enough question about something.",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an obviously-malformed email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Question",
        body: "A long enough question about something.",
        email: "not-an-email",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/support — happy path (anonymous)", () => {
  it("sends to the support inbox + a confirmation to the user", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req(
        {
          subject: "Question about pricing",
          body: "Could you tell me more about the Pro plan features?",
          email: "guest@example.com",
        },
        { ua: "TestUserAgent/1.0" },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    // First call: internal email to the support inbox with the
    // user's address as Reply-To.
    const internal = mockSendEmail.mock.calls[0]?.[0] as {
      to: string;
      replyTo?: string;
      subject: string;
    };
    expect(internal.to).toBe("support@maqro.app");
    expect(internal.replyTo).toBe("guest@example.com");
    expect(internal.subject).toMatch(/Maqro support/);

    // Second call: confirmation back to the user, no Reply-To.
    const confirm = mockSendEmail.mock.calls[1]?.[0] as {
      to: string;
      replyTo?: string;
    };
    expect(confirm.to).toBe("guest@example.com");
    expect(confirm.replyTo).toBeUndefined();
  });
});

describe("POST /api/support — logged-in user", () => {
  it("uses the auth email, ignoring whatever's in the body", async () => {
    mockGetSupabaseServer.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email: "alice@example.com" } },
        })),
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Question",
        body: "A long enough message body for me to send through.",
        email: "spoofer@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const internal = mockSendEmail.mock.calls[0]?.[0] as { replyTo?: string };
    expect(internal.replyTo).toBe("alice@example.com");
  });
});

describe("POST /api/support — error paths", () => {
  it("returns 429 when the rate limit blocks", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ allowed: false, count: 50, retry_after_seconds: 600 }],
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Spam",
        body: "Hello hello hello hello hello.",
        email: "spammer@example.com",
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 502 when the internal send fails (user's message is lost)", async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: "Resend down" });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Help",
        body: "I need help with something specific.",
        email: "user@example.com",
      }),
    );
    expect(res.status).toBe(502);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("returns 200 even if confirmation send fails (best-effort)", async () => {
    // First send (internal) succeeds; second (confirmation) fails.
    mockSendEmail
      .mockResolvedValueOnce({ ok: true, id: "msg-1" })
      .mockResolvedValueOnce({ ok: false, error: "Confirm bounced" });
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        subject: "Hi",
        body: "A reasonably long body of content here.",
        email: "u@example.com",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockReportServerError).toHaveBeenCalled();
  });
});
