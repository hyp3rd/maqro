import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { mockInsert } = vi.hoisted(() => ({ mockInsert: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: mockInsert }) }),
    }),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      })),
    },
  })),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: vi.fn(() => ({
    url: "https://test.supabase.co",
    secretKey: "sb_secret_…",
  })),
}));

describe("POST /api/capture/init", () => {
  beforeEach(() => {
    mockInsert.mockReset();
  });

  it("creates a row and returns { id, expiresAt }", async () => {
    mockInsert.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        expires_at: "2026-05-16T11:00:00.000Z",
      },
      error: null,
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; expiresAt: string };
    expect(body.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.expiresAt).toBe("2026-05-16T11:00:00.000Z");
  });

  it("returns 401 when no Supabase session", async () => {
    const server = await import("@/lib/supabase/server");
    vi.mocked(server.getSupabaseServer).mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    } as unknown as Awaited<ReturnType<typeof server.getSupabaseServer>>);
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 503 when SUPABASE_SECRET_KEY is missing", async () => {
    const env = await import("@/lib/supabase/env");
    vi.mocked(env.getSupabaseSecretConfig).mockReturnValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("returns 500 when the insert fails", async () => {
    mockInsert.mockResolvedValue({
      data: null,
      error: { message: "RLS denied" },
    });
    const res = await POST();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/RLS denied/);
  });
});
