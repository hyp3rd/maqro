import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/cron/auto-adapt-tdee — the maintenance it compares against (and
 *  the phase-override skip) must come from the shared `targetsForDate`
 *  resolver, so the cron reasons about the same target the app shows. */

const {
  mockLoadUserTier,
  mockDecideAutoAdapt,
  mockTargetsForDate,
  profileRows,
} = vi.hoisted(() => ({
  mockLoadUserTier: vi.fn(async () => "pro"),
  mockDecideAutoAdapt: vi.fn<
    (opts: { observed: unknown; currentTdee: number }) => {
      action: "skip";
      newTdee: null;
      deltaKcal: number;
    }
  >(() => ({ action: "skip", newTdee: null, deltaKcal: 0 })),
  mockTargetsForDate: vi.fn(),
  profileRows: [] as { user_id: string; payload: unknown }[],
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  }),
}));
vi.mock("@/lib/billing/usage", () => ({ loadUserTier: mockLoadUserTier }));
vi.mock("@/lib/supabase/admin-users", () => ({
  listAllAuthUsers: async () => ({ users: [], error: null }),
  emailsById: () => new Map<string, string>(),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/push/send", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/trends", () => ({
  inferAdaptiveTdee: () => ({ observedTdee: 2300, confidence: "high" }),
  decideAutoAdapt: mockDecideAutoAdapt,
}));
vi.mock("@maqro/core/targets", async () => {
  const actual = await vi.importActual<typeof import("@maqro/core/targets")>(
    "@maqro/core/targets",
  );
  mockTargetsForDate.mockImplementation(actual.targetsForDate);
  return { targetsForDate: mockTargetsForDate };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: {} },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({ data: profileRows, error: null }),
            }),
          }),
        };
      }
      if (table === "notification_preferences") {
        return { select: () => ({ in: async () => ({ data: [] }) }) };
      }
      // weight_history (.eq().order()) and daily_logs (.eq().lte()).
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: [] }),
            lte: async () => ({ data: [] }),
          }),
        }),
      };
    },
  })),
}));

const TODAY = "2026-06-10";

function profile(tdeeOverride: number | null) {
  return {
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
    autoAdaptTdee: true,
    units: "metric",
    goalPhases: [
      {
        id: "ph_cut",
        kind: "cut",
        startDate: "2026-06-01",
        durationWeeks: 4,
        weeklyRateKg: 0.5,
        tdeeOverride,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  mockLoadUserTier.mockResolvedValue("pro");
  profileRows.splice(0, profileRows.length);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function callRoute(): Promise<Record<string, unknown>> {
  const { GET } = await import("./route");
  const res = await GET(
    new Request("http://localhost/api/cron/auto-adapt-tdee", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/cron/auto-adapt-tdee — current TDEE", () => {
  it("compares against the resolver's TDEE for today (Pro phases on)", async () => {
    const payload = profile(null);
    profileRows.push({ user_id: "u1", payload });
    await callRoute();
    expect(mockTargetsForDate).toHaveBeenCalledWith(payload, TODAY, {
      phasesEnabled: true,
    });
    expect(mockDecideAutoAdapt).toHaveBeenCalledTimes(1);
    expect(mockDecideAutoAdapt.mock.calls[0]?.[0].currentTdee).toBe(2600);
  });

  it("skips a user whose active phase pins its own TDEE (found via the resolver)", async () => {
    profileRows.push({ user_id: "u1", payload: profile(2450) });
    const body = await callRoute();
    expect(mockTargetsForDate).toHaveBeenCalledTimes(1);
    expect(mockDecideAutoAdapt).not.toHaveBeenCalled();
    expect(body).toMatchObject({ skipped: 1, applied: 0, held: 0 });
  });

  it("a downgrade stops auto-adapt before any target is resolved", async () => {
    mockLoadUserTier.mockResolvedValue("free");
    profileRows.push({ user_id: "u1", payload: profile(2450) });
    const body = await callRoute();
    expect(mockTargetsForDate).not.toHaveBeenCalled();
    expect(body).toMatchObject({ skipped: 1 });
  });
});
