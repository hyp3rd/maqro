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
  mockComputeWeeklyRecap,
  mockLoadUserTier,
  mockLoadBodyFat,
  optedInRows,
  profileRow,
  gteCalls,
} = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetSupabaseSecretConfig: vi.fn(() => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  })),
  mockComputeWeeklyRecap: vi.fn<
    (
      logs: unknown,
      weights: unknown,
      targetCaloriesFor: (date: string) => number,
      today: string,
    ) => { daysLogged: number }
  >(() => ({ daysLogged: 3 })),
  mockLoadUserTier: vi.fn(async () => "free"),
  mockLoadBodyFat: vi.fn<
    (
      admin: unknown,
      userId: string,
      profile: unknown,
    ) => Promise<
      | { ok: true; bodyFatPct: number | null }
      | { ok: false; error: { message: string } }
    >
  >(async () => ({ ok: true, bodyFatPct: null })),
  optedInRows: [] as { user_id: string; timezone?: string | null }[],
  /** The `profiles` row the fake returns (`null` = no profile yet). */
  profileRow: { value: null as { payload: unknown } | null },
  /** Every `.gte(column, value)` the route issues, per table. */
  gteCalls: [] as [string, string, string][],
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/email/templates", () => ({
  weeklyRecapEmail: () => ({ subject: "s", html: "h", text: "t" }),
}));
vi.mock("@/lib/weekly-recap", () => ({
  computeWeeklyRecap: mockComputeWeeklyRecap,
}));
vi.mock("@/lib/billing/usage", () => ({ loadUserTier: mockLoadUserTier }));
vi.mock("@/lib/latest-body-fat", () => ({
  loadLatestBodyFatPct: mockLoadBodyFat,
}));
// The real resolver, observed: every call's context is asserted below.
vi.mock("@maqro/core/targets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@maqro/core/targets")>();
  return { ...actual, targetsForDate: vi.fn(actual.targetsForDate) };
});
vi.mock("@supabase/supabase-js", () => {
  const rows = (data: unknown, table: string) => ({
    eq: () => ({
      gte: (column: string, value: string) => {
        gteCalls.push([table, column, value]);
        return { order: async () => ({ data, error: null }) };
      },
      maybeSingle: async () => ({ data: profileRow.value, error: null }),
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
        return { select: () => rows([], table) };
      },
    })),
  };
});

function userId(n: number): string {
  return `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  profileRow.value = null;
  gteCalls.splice(0, gteCalls.length);
  mockLoadUserTier.mockResolvedValue("free");
  mockLoadBodyFat.mockResolvedValue({ ok: true, bodyFatPct: null });
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
  vi.useRealTimers();
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

/** The recap's adherence targets must be the SAME numbers the app shows:
 *  each logged day scored against its own `targetsForDate` target, with the
 *  tier re-checked here, in a window ending on the user's local "today".
 *  Linear goal: maintain at 2600; a cut (−550/day, own maintenance 2450 →
 *  1900) starts on 2026-06-15. */
describe("GET /api/cron/weekly-recap — target", () => {
  const PROFILE = {
    gender: "male",
    age: 30,
    weight: 80,
    height: 180,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    manualTdee: 2600,
    units: "metric",
    goalPhases: [
      {
        id: "ph_cut",
        kind: "cut",
        startDate: "2026-06-15",
        durationWeeks: 4,
        weeklyRateKg: 0.5,
        tdeeOverride: 2450,
      },
    ],
  };

  beforeEach(() => {
    // 20:00 UTC on Sunday 14 June = 08:00 Monday 15 June in Auckland.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T20:00:00Z"));
    profileRow.value = { payload: PROFILE };
  });

  function lastRecapArgs() {
    const call = mockComputeWeeklyRecap.mock.calls.at(-1);
    if (!call) throw new Error("computeWeeklyRecap was not called");
    return call;
  }
  /** The last recap's per-day target resolver read on its today, and that
   *  today. */
  function lastRecapCall(): [number, string] {
    const [, , targetFor, today] = lastRecapArgs();
    return [targetFor(today), today];
  }

  it("a Pro user's active phase drives the target, on their local today", async () => {
    mockLoadUserTier.mockResolvedValue("pro");
    optedInRows.splice(0, optedInRows.length, {
      user_id: userId(TARGET_INDEX),
      timezone: "Pacific/Auckland",
    });
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(mockLoadUserTier).toHaveBeenCalledWith(
      expect.anything(),
      userId(TARGET_INDEX),
    );
    expect(lastRecapCall()).toEqual([1900, "2026-06-15"]);
    // Every day in the window resolves its own target: the days before the
    // cut started keep the linear 2600.
    const [, , targetFor] = lastRecapArgs();
    expect(targetFor("2026-06-14")).toBe(2600);
    expect(targetFor("2026-06-09")).toBe(2600);
    // Window: the 7 days ending the local today.
    expect(gteCalls).toContainEqual(["daily_logs", "date", "2026-06-09"]);
  });

  it("without Pro the phase is ignored (linear goal)", async () => {
    mockLoadUserTier.mockResolvedValue("plus");
    optedInRows.splice(0, optedInRows.length, {
      user_id: userId(TARGET_INDEX),
      timezone: "Pacific/Auckland",
    });
    await callRoute();
    expect(lastRecapCall()).toEqual([2600, "2026-06-15"]);
  });

  it("no stored timezone keeps the UTC day (before the phase starts)", async () => {
    mockLoadUserTier.mockResolvedValue("pro");
    optedInRows.splice(0, optedInRows.length, {
      user_id: userId(TARGET_INDEX),
      timezone: null,
    });
    await callRoute();
    expect(lastRecapCall()).toEqual([2600, "2026-06-14"]);
    expect(gteCalls).toContainEqual(["daily_logs", "date", "2026-06-08"]);
  });
});

/** The email scores days against the SAME targets the app shows, so the
 *  resolver gets the same body-fat estimate the app derives
 *  (`latestBodyFatPct` over the latest usable body measurement). */
describe("GET /api/cron/weekly-recap — body fat", () => {
  const PROFILE = {
    gender: "male",
    age: 30,
    weight: 80,
    height: 180,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    manualTdee: 2600,
    units: "metric",
    // An enabled week: the targets then read the body-fat estimate.
    training: {
      enabled: true,
      cycling: "modest",
      days: [
        { type: "rest" },
        { type: "upper", intensity: "moderate" },
        { type: "rest" },
        { type: "lower", intensity: "hard" },
        { type: "rest" },
        { type: "fullBody", intensity: "moderate" },
        { type: "endurance", intensity: "moderate", durationMin: 90 },
      ],
    },
  };

  beforeEach(() => {
    profileRow.value = { payload: PROFILE };
  });

  it("passes the user's body-fat estimate to every target it resolves", async () => {
    const { targetsForDate } = await import("@maqro/core/targets");
    const resolver = vi.mocked(targetsForDate);
    mockLoadBodyFat.mockResolvedValue({ ok: true, bodyFatPct: 18.4 });
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(mockLoadBodyFat).toHaveBeenCalledWith(
      expect.anything(),
      userId(TARGET_INDEX),
      PROFILE,
    );
    // Today's target and each day the recap scores.
    const [, , targetFor] = mockComputeWeeklyRecap.mock.calls.at(-1) ?? [];
    targetFor?.("2026-06-10");
    expect(resolver.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, , ctx] of resolver.mock.calls) {
      expect(ctx).toEqual({ phasesEnabled: false, bodyFatPct: 18.4 });
    }
  });

  it("skips the user (an error, no email) when the measurements can't be read", async () => {
    mockLoadBodyFat.mockResolvedValue({
      ok: false,
      error: { message: "db down" },
    });
    const res = await callRoute();
    expect(await res.json()).toEqual({ sent: 0, skipped: 0, errors: 1 });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockComputeWeeklyRecap).not.toHaveBeenCalled();
  });

  it("makes no measurement read while training is off (nothing it could change)", async () => {
    const { targetsForDate } = await import("@maqro/core/targets");
    const resolver = vi.mocked(targetsForDate);
    profileRow.value = { payload: { ...PROFILE, training: undefined } };
    mockLoadBodyFat.mockResolvedValue({
      ok: false,
      error: { message: "db down" },
    });
    const res = await callRoute();
    expect(mockLoadBodyFat).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ errors: 0 });
    expect(mockComputeWeeklyRecap).toHaveBeenCalled();
    for (const [, , ctx] of resolver.mock.calls) {
      expect(ctx).toEqual({ phasesEnabled: false, bodyFatPct: null });
    }
  });

  it("makes no measurement read for a user without a profile", async () => {
    profileRow.value = null;
    await callRoute();
    expect(mockLoadBodyFat).not.toHaveBeenCalled();
  });
});
