import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/cron/weekly-recap — the email map must cover the WHOLE auth user
 *  base. `auth.admin.listUsers()` without params returns only GoTrue's default
 *  page of 50, which silently skipped every opted-in user outside it. The fake
 *  below behaves like the real offset-paginated `/admin/users` endpoint. */

const TOTAL_USERS = 1_234;
const TARGET_INDEX = 1_200; // outside both the 50 default and a 1000 page

const {
  mockListUsers,
  mockSendEmail,
  mockGetSupabaseSecretConfig,
  optedInRows,
} = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  optedInRows: [] as { user_id: string }[],
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/email/templates", () => ({
  weeklyRecapEmail: () => ({ subject: "s", html: "h", text: "t" }),
}));
vi.mock("@/lib/weekly-recap", () => ({
  computeWeeklyRecap: () => ({ daysLogged: 3 }),
}));
vi.mock("@supabase/supabase-js", () => {
  const rows = (data: unknown) => ({
    eq: () => ({
      gte: () => ({ order: async () => ({ data, error: null }) }),
      maybeSingle: async () => ({ data: null, error: null }),
    }),
  });
  return {
    createClient: vi.fn(() => ({
      auth: { admin: { listUsers: mockListUsers } },
      from: (table: string) => {
        if (table === "notification_preferences") {
          return {
            select: () => ({
              eq: async () => ({ data: optedInRows, error: null }),
            }),
          };
        }
        return { select: () => rows([]) };
      },
    })),
  };
});

function userId(n: number): string {
  return `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  optedInRows.splice(0, optedInRows.length, { user_id: userId(TARGET_INDEX) });
  const all = Array.from({ length: TOTAL_USERS }, (_, i) => ({
    id: userId(i + 1),
    email: `user${i + 1}@example.com`,
  }));
  mockListUsers.mockImplementation(
    async (params?: { page?: number; perPage?: number }) => {
      const page = params?.page ?? 1;
      const perPage = params?.perPage ?? 50; // GoTrue server default
      return {
        data: {
          users: all.slice((page - 1) * perPage, page * perPage),
          aud: "authenticated",
          nextPage: null,
          lastPage: 0,
          total: TOTAL_USERS,
        },
        error: null,
      };
    },
  );
  mockSendEmail.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function callRoute(): Promise<Response> {
  const { GET } = await import("./route");
  return GET(
    new Request("http://localhost/api/cron/weekly-recap", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
}

describe("GET /api/cron/weekly-recap", () => {
  it("emails an opted-in user who is beyond the first page of auth users", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: `user${TARGET_INDEX}@example.com` }),
    );
  });

  it("returns 500 when listing users fails instead of skipping everyone", async () => {
    const { AuthError } = await vi.importActual<
      typeof import("@supabase/supabase-js")
    >("@supabase/supabase-js");
    mockListUsers.mockResolvedValue({
      data: { users: [] },
      error: new AuthError("auth down", 500),
    });
    const res = await callRoute();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "auth down" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
