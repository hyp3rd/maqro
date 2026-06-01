/**
 * @vitest-environment node
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUserRole, requireAdmin } from "./rbac";

// Mock the Supabase modules BEFORE importing rbac. Vitest hoists
// these so they're in place when the import resolves.
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServer: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseSecretConfig: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const mockedGetServer = vi.mocked(getSupabaseServer);

function buildSupabaseStub(opts: {
  user: { id: string } | null;
  role?: string | null;
}): unknown {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: opts.user }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: opts.role !== undefined ? { role: opts.role } : null,
            }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  mockedGetServer.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("currentUserRole", () => {
  it("returns 'user' when Supabase is not configured", async () => {
    mockedGetServer.mockResolvedValue(null);
    expect(await currentUserRole()).toBe("user");
  });

  it("returns 'user' when no one is signed in", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: null }) as never,
    );
    expect(await currentUserRole()).toBe("user");
  });

  it("returns 'admin' when the profile row says admin", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, role: "admin" }) as never,
    );
    expect(await currentUserRole()).toBe("admin");
  });

  it("returns 'user' when role is missing or any non-admin value", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, role: "user" }) as never,
    );
    expect(await currentUserRole()).toBe("user");

    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, role: null }) as never,
    );
    expect(await currentUserRole()).toBe("user");
  });
});

describe("requireAdmin", () => {
  it("returns 503 when Supabase isn't configured", async () => {
    mockedGetServer.mockResolvedValue(null);
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("returns 401 when there's no user session", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: null }) as never,
    );
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 403 when the user isn't an admin", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, role: "user" }) as never,
    );
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("returns ok with userId when caller is admin", async () => {
    mockedGetServer.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, role: "admin" }) as never,
    );
    const result = await requireAdmin();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("u1");
    }
  });
});
