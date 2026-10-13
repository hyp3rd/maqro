import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "a0000000-0000-4000-8000-000000000001";

const sendEmail = vi.fn();
const weeklyRecapEmail = vi.fn();
let profilePayload: unknown = null;

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "http://supabase.test",
    secretKey: "service-role",
  }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));
vi.mock("@/lib/email/templates", () => ({ weeklyRecapEmail }));

/** Minimal service-role client: every table read the cron makes resolves
 *  through `select(...).eq(...)` chains, optionally ending in `.gte()`,
 *  `.order()` or `.maybeSingle()`. */
function tableResult(table: string): { data: unknown; error: null } {
  switch (table) {
    case "notification_preferences":
      return { data: [{ user_id: USER_ID }], error: null };
    case "profiles":
      return { data: { payload: profilePayload }, error: null };
    case "daily_logs": {
      const today = new Date().toISOString().slice(0, 10);
      return {
        data: [
          {
            date: today,
            meals: [
              {
                id: "m1",
                name: "Lunch",
                foods: [
                  {
                    id: "f1",
                    name: "Rice",
                    protein: 10,
                    carbs: 80,
                    fat: 2,
                    calories: 380,
                  },
                ],
              },
            ],
            updated_at: `${today}T12:00:00Z`,
          },
        ],
        error: null,
      };
    }
    default:
      return { data: [], error: null };
  }
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        listUsers: () =>
          Promise.resolve({
            data: { users: [{ id: USER_ID, email: "user@example.test" }] },
            error: null,
          }),
      },
    },
    from: (table: string) => {
      const result = tableResult(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

const { GET } = await import("./route");

function cronRequest(): Request {
  return new Request("http://localhost/api/cron/weekly-recap", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("GET /api/cron/weekly-recap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    weeklyRecapEmail.mockReturnValue({
      subject: "Your week",
      html: "<p>recap</p>",
      text: "recap",
    });
    sendEmail.mockResolvedValue({ ok: true });
  });

  it("treats a placeholder profile ({} payload) as no profile: target 0, not NaN", async () => {
    // Migration 0074 gives every account a profiles row at sign-up with an
    // empty payload. Feeding `{}` into computeMacros yields NaN targets.
    profilePayload = {};

    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    expect(weeklyRecapEmail).toHaveBeenCalledTimes(1);
    expect(weeklyRecapEmail.mock.calls[0]?.[0]).toMatchObject({
      targetCalories: 0,
    });
  });
});
