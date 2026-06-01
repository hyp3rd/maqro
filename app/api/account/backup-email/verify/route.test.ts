import { hashBackupEmailCode } from "@/lib/account/backup-email";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockSelectMaybeSingle,
  mockUpdateEq,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockSelectMaybeSingle: vi.fn(),
  mockUpdateEq: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockSelectMaybeSingle }) }),
      update: () => ({ eq: mockUpdateEq }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/account/backup-email/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FRESH_EXPIRY = new Date(Date.now() + 5 * 60_000).toISOString();
const STALE_EXPIRY = new Date(Date.now() - 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "alice@example.com" } },
      })),
    },
  });
});

describe("POST /api/account/backup-email/verify", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { POST } = await loadRoute();
    expect((await POST(req({ code: "123456" }))).status).toBe(401);
  });

  it("returns 400 when the code isn't 6 digits", async () => {
    const { POST } = await loadRoute();
    expect((await POST(req({ code: "12345" }))).status).toBe(400);
    expect((await POST(req({ code: "abcdef" }))).status).toBe(400);
    expect((await POST(req({ code: 123456 }))).status).toBe(400);
  });

  it("returns 400 when no pending verification exists", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        backup_email_pending: null,
        backup_email_code_hash: null,
        backup_email_code_expires_at: null,
      },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the code is expired", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        backup_email_pending: "b@example.com",
        backup_email_code_hash: hashBackupEmailCode("123456"),
        backup_email_code_expires_at: STALE_EXPIRY,
      },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 (generic) when the code doesn't match", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        backup_email_pending: "b@example.com",
        backup_email_code_hash: hashBackupEmailCode("123456"),
        backup_email_code_expires_at: FRESH_EXPIRY,
      },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ code: "999999" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // Same message for "expired" and "wrong" — see route comments
    // for the rationale (don't leak which condition triggered).
    expect(body.error).toMatch(/match|expired/i);
  });

  it("promotes pending → backup_email on a correct code", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        backup_email_pending: "b@example.com",
        backup_email_code_hash: hashBackupEmailCode("123456"),
        backup_email_code_expires_at: FRESH_EXPIRY,
      },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ code: "123456" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backupEmail: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.backupEmail).toBe("b@example.com");
    // The UPDATE must clear the OTP fields so the same code can't
    // be replayed against a future "pending".
    expect(mockUpdateEq).toHaveBeenCalled();
  });
});
