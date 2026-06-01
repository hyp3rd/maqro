import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for DELETE /api/account/backup-email — clears every backup-
 *  email column on the caller's profile row. Five distinct branches:
 *  unconfigured Supabase, no session, missing service-role key,
 *  update error, success. The update payload itself is also
 *  asserted because the route's contract is "wipe all five columns
 *  in one shot" — getting that subset wrong would leave a half-
 *  pending state that re-appears in the UI on next load. */

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockUpdatePayload,
  mockUpdateEq,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  // Cast widens the narrow inferred type so a test can override
  // with `null` (unconfigured-key branch) without TS pinning to the
  // happy-path object shape.
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  // Capture the object passed to `.update(...)` so we can assert
  // exactly which columns the route wipes. Returns the chainable
  // shape `{ eq }`.
  mockUpdatePayload: vi.fn(() => ({ eq: mockUpdateEq })),
  // Same widening — override calls pass `{ error: { message } }`
  // for the failure test.
  mockUpdateEq: vi.fn(
    async () => ({ error: null }) as { error: { message: string } | null },
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => ({ update: mockUpdatePayload }) })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "alice@example.com" } },
      })),
    },
  });
  mockUpdatePayload.mockImplementation(() => ({ eq: mockUpdateEq }));
  mockUpdateEq.mockResolvedValue({ error: null });
});

describe("DELETE /api/account/backup-email", () => {
  it("returns 503 when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(503);
    expect(mockUpdatePayload).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockUpdatePayload).not.toHaveBeenCalled();
  });

  it("returns 503 when the service-role key isn't configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(503);
    expect(mockUpdatePayload).not.toHaveBeenCalled();
  });

  it("returns 500 and propagates the message when the update errors", async () => {
    mockUpdateEq.mockResolvedValueOnce({
      error: { message: "permission denied on profiles" },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("permission denied on profiles");
  });

  it("returns 204 and nulls every backup-email column on success", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(204);
    // 204 carries no body — confirm we didn't accidentally
    // serialize JSON on a no-content response.
    expect(res.body).toBeNull();

    // The handler must wipe all five columns. Anything less leaves
    // a half-state.
    expect(mockUpdatePayload).toHaveBeenCalledWith({
      backup_email: null,
      backup_email_verified_at: null,
      backup_email_pending: null,
      backup_email_code_hash: null,
      backup_email_code_expires_at: null,
    });
    // And it must scope the update to the caller's row only.
    expect(mockUpdateEq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
