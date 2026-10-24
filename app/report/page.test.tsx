/**
 * @vitest-environment jsdom
 */
import { writeCachedTier } from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import type { DailyLog } from "@/lib/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import { act, cleanup, render, screen } from "@testing-library/react";

/** /report must show the SAME target as the app: phase-aware via the shared
 *  `targetsForDate` resolver + tier gate (it used to call a bare
 *  `computeMacros(profile)` — 2600 kcal for a Pro user cutting at 1900). */

/** Linear goal: maintain at 2600. Active cut (−550/day) with its own
 *  2450 maintenance → 1900 kcal for a Pro user. */
const PROFILE: PersonalInfo = {
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
      startDate: "2026-06-01",
      durationWeeks: 4,
      weeklyRateKg: 0.5,
      tdeeOverride: 2450,
    },
  ],
};

/** What the mocked IDB / URL serve; the defaults are the target tests'. */
const data = vi.hoisted(() => ({
  query: "sections=calories",
  profile: null as PersonalInfo | null,
  logs: [] as DailyLog[],
}));

/** A logged day with one food of `calories`. */
function logged(date: string, calories: number): DailyLog {
  return {
    date,
    meals: [
      {
        id: 1,
        name: "Lunch",
        foods: [
          {
            id: 1,
            name: "Rice",
            protein: 10,
            carbs: 100,
            fat: 5,
            calories,
            portionSize: 100,
          },
        ],
      },
    ],
    updatedAt: 0,
  };
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(data.query),
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "u1" } as User,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("@/components/shell/MiniLineChart", () => ({
  MiniLineChart: () => null,
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    getProfile: async () => data.profile,
    listWeightEntries: async () => [],
    listDailyLogs: async () => data.logs,
    listBodyMeasurements: async () => [],
    listMicronutrientProfiles: async () => [],
    listBloodPressure: async () => [],
    listWaterIntake: async () => [],
    // The real local-day key, read off the (faked) clock — what `useToday`
    // and the report's windows run on.
    todayKey: actual.todayKey,
  };
});

const fetchMock = vi.fn<(input: string) => Promise<Response>>();

function usage(tier: Tier): Response {
  return new Response(
    JSON.stringify({ used: 0, cap: null, tier, isPremium: tier !== "free" }),
    { status: 200 },
  );
}

beforeEach(() => {
  data.query = "sections=calories";
  data.profile = PROFILE;
  data.logs = [logged("2026-06-09", 1850)];
  vi.useFakeTimers({ toFake: ["Date"] });
  // Midday on 2026-06-10, inside PROFILE's cut.
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderReport() {
  const { default: ReportPage } = await import("./page");
  render(<ReportPage />);
}

describe("/report target", () => {
  it("a Pro user's active phase drives the report target", async () => {
    fetchMock.mockResolvedValue(usage("pro"));
    await renderReport();
    expect(
      await screen.findByText("Daily kcal vs target of 1900 kcal."),
    ).toBeTruthy();
  });

  it("without Pro the linear goal drives it", async () => {
    fetchMock.mockResolvedValue(usage("free"));
    await renderReport();
    expect(
      await screen.findByText("Daily kcal vs target of 2600 kcal."),
    ).toBeTruthy();
    // Let the usage response settle: the free answer must keep it linear.
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/target of 1900 kcal/)).toBeNull();
    expect(screen.getByText("Daily kcal vs target of 2600 kcal.")).toBeTruthy();
  });

  it("offline, the cached Pro tier keeps the phase target", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderReport();
    expect(
      await screen.findByText("Daily kcal vs target of 1900 kcal."),
    ).toBeTruthy();
  });
});

/** The report's day is the user's LOCAL day — for the target AND for every
 *  window (recap, streak, range cutoff). Run in a zone east of UTC, where
 *  just after local midnight the UTC date is still yesterday. */
describe("/report local day", () => {
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo"; // UTC+9, no DST
  });
  afterAll(() => {
    process.env.TZ = savedTz;
  });

  /** A Pro cut that starts on 2026-06-11: 1900 kcal from that day, the
   *  linear 2600 before it. */
  const CUT_FROM_11: PersonalInfo = {
    ...PROFILE,
    goalPhases: [
      {
        id: "ph_cut",
        kind: "cut",
        startDate: "2026-06-11",
        durationWeeks: 1,
        weeklyRateKg: 0.5,
        tdeeOverride: 2450,
      },
    ],
  };

  beforeEach(() => {
    vi.useRealTimers();
    // setTimeout too: `useToday` schedules its midnight roll-over with it.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    data.query = "sections=summary,calories";
    data.profile = CUT_FROM_11;
    data.logs = [logged("2026-06-11", 1900)];
    fetchMock.mockResolvedValue(usage("pro"));
  });

  /** Settle the IDB load and the tier fetch without moving the clock. */
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  }

  it("just after local midnight the target and the recap window are the same day", async () => {
    // 00:30 on the 11th in Tokyo — still 15:30 on the 10th in UTC.
    vi.setSystemTime(new Date(2026, 5, 11, 0, 30, 0));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-06-10");
    await renderReport();
    await settle();

    expect(screen.getByText("Daily kcal vs target of 1900 kcal.")).toBeTruthy();
    // Today's log is inside the 7-day recap, scored against today's target.
    expect(screen.getByText("1 / 7")).toBeTruthy();
    expect(screen.getByText("100% within ±10%")).toBeTruthy();
  });

  it("scores each recap day against that day's own target", async () => {
    // The 10th predates the cut (2600), the 11th is in it (1900); each log
    // hits its own day's target. Against today's 1900 alone, the 10th
    // (+37%) would be off.
    data.logs = [logged("2026-06-10", 2600), logged("2026-06-11", 1900)];
    vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0));
    await renderReport();
    await settle();

    expect(screen.getByText("Daily kcal vs target of 1900 kcal.")).toBeTruthy();
    expect(screen.getByText("2 / 7")).toBeTruthy();
    expect(screen.getByText("100% within ±10%")).toBeTruthy();
  });

  it("a report left open past midnight rolls over to the new day", async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 23, 59, 30));
    await renderReport();
    await settle();
    expect(screen.getByText("Daily kcal vs target of 2600 kcal.")).toBeTruthy();
    // The 11th hasn't started: its log is outside the window.
    expect(screen.getByText("0 / 7")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("Daily kcal vs target of 1900 kcal.")).toBeTruthy();
    expect(screen.getByText("1 / 7")).toBeTruthy();
  });
});
