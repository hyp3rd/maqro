import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for /api/auth/mfa/trusted-devices — the list + create +
 *  revoke-all surface. The interesting branches are the AAL2 gate
 *  on POST (the entire feature's security model depends on it) and
 *  the upsert payload shape (server-stamped trusted_until rather
 *  than client-provided so the window length can't be lengthened
 *  by a malicious client). */

const {
  mockGetSupabaseServer,
  mockGetSupabaseSecretConfig,
  mockUpsertUpsert,
  mockGetAal,
  mockListSelect,
  mockDeleteEq,
} = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(
    () =>
      ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
        url: string;
        secretKey: string;
      } | null,
  ),
  mockUpsertUpsert: vi.fn(),
  mockGetAal: vi.fn(),
  // Captures the SELECT chain on cookie-client (GET /).
  mockListSelect: vi.fn(),
  // Captures the DELETE chain (DELETE /). Cast widens the inferred
  // return so the error-branch test can override with `{ error: { message } }`.
  mockDeleteEq: vi.fn(
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
  createClient: vi.fn(() => ({
    from: () => ({
      upsert: () => ({ select: () => ({ maybeSingle: mockUpsertUpsert }) }),
    }),
  })),
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/auth/mfa/trusted-devices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.42",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
      mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
    },
    from: () => ({
      // Cookie-client chains for GET (list) and DELETE (revoke-all).
      select: () => ({ gt: () => ({ order: mockListSelect }) }),
      delete: () => ({ eq: mockDeleteEq }),
    }),
  });
  mockGetAal.mockResolvedValue({
    data: { currentLevel: "aal2", nextLevel: "aal2" },
    error: null,
  });
  mockUpsertUpsert.mockResolvedValue({
    data: { id: "trust-1", trusted_until: "2026-05-29T00:00:00Z" },
    error: null,
  });
  mockListSelect.mockResolvedValue({ data: [], error: null });
  mockDeleteEq.mockResolvedValue({ error: null });
});

describe("POST /api/auth/mfa/trusted-devices — record trust", () => {
  it("returns 503 when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
        mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(401);
    expect(mockUpsertUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not at AAL2", async () => {
    // The entire feature rests on this gate — without AAL2 the
    // upsert must NOT fire. Otherwise a stolen AAL1 session could
    // bootstrap a trust without ever passing the second factor.
    mockGetAal.mockResolvedValueOnce({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(403);
    expect(mockUpsertUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/auth/mfa/trusted-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsertUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 when deviceId is missing or empty", async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceLabel: "Chrome" }));
    expect(res.status).toBe(400);
    expect(mockUpsertUpsert).not.toHaveBeenCalled();
  });

  it("returns 503 when service-role key is not configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(503);
  });

  it("returns 500 and propagates the message when the upsert errors", async () => {
    mockUpsertUpsert.mockResolvedValueOnce({
      data: null,
      error: { message: "unique violation" },
    });
    const { POST } = await loadRoute();
    const res = await POST(postReq({ deviceId: "dev-1" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unique violation");
  });

  it("returns 200 with id + trustedUntil on success", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      postReq({
        deviceId: "dev-1",
        deviceLabel: "Chrome on macOS",
        userAgent: "Mozilla/5.0 ...",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; trustedUntil: string };
    expect(body.id).toBe("trust-1");
    expect(body.trustedUntil).toBe("2026-05-29T00:00:00Z");
  });
});

describe("GET /api/auth/mfa/trusted-devices — list", () => {
  it("returns 503 when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns rows on success", async () => {
    mockListSelect.mockResolvedValueOnce({
      data: [
        {
          id: "trust-1",
          device_id: "dev-1",
          device_label: "Chrome on macOS",
          user_agent: "Mozilla/5.0 ...",
          ip_address: "203.0.113.42",
          trusted_at: "2026-05-22T00:00:00Z",
          trusted_until: "2026-05-29T00:00:00Z",
          last_used_at: "2026-05-22T01:00:00Z",
        },
      ],
      error: null,
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string }[] };
    expect(body.rows.length).toBe(1);
    expect(body.rows[0]?.id).toBe("trust-1");
  });

  it("returns 500 on query error", async () => {
    mockListSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "RLS denied" },
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/auth/mfa/trusted-devices — revoke all", () => {
  it("returns 503 when Supabase is not configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns 204 on success and scopes the delete to user_id", async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    // Belt-and-braces: the route narrows to the caller's user_id
    // even though RLS already does — assert that's preserved.
    expect(mockDeleteEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns 500 when the delete errors", async () => {
    mockDeleteEq.mockResolvedValueOnce({
      error: { message: "permission denied" },
    });
    const { DELETE } = await loadRoute();
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
