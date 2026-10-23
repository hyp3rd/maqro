/**
 * @vitest-environment jsdom
 */
import { writeCachedTier } from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import { act, cleanup, render, screen } from "@testing-library/react";

/** /report must show the SAME target as the app: phase-aware via the shared
 *  `targetsForDate` resolver + tier gate (it used to call a bare
 *  `computeMacros(profile)` — 2600 kcal for a Pro user cutting at 1900). */

const TODAY = "2026-06-10";

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("sections=calories"),
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
vi.mock("@/lib/db", () => ({
  getProfile: async () => PROFILE,
  listWeightEntries: async () => [],
  listDailyLogs: async () => [
    {
      date: "2026-06-09",
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
              calories: 1850,
              portionSize: 100,
            },
          ],
        },
      ],
      updatedAt: 0,
    },
  ],
  listBodyMeasurements: async () => [],
  listMicronutrientProfiles: async () => [],
  listBloodPressure: async () => [],
  listWaterIntake: async () => [],
  todayKey: () => TODAY,
}));

const fetchMock = vi.fn<(input: string) => Promise<Response>>();

function usage(tier: Tier): Response {
  return new Response(
    JSON.stringify({ used: 0, cap: null, tier, isPremium: tier !== "free" }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
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
