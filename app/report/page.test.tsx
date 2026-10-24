/**
 * @vitest-environment jsdom
 */
import { writeCachedTier } from "@/lib/billing/tier-cache";
import type { Tier } from "@/lib/billing/tiers";
import type { BodyMeasurement, DailyLog } from "@/lib/db";
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
import { estimateBodyFat } from "@maqro/core/body-fat";
import { targetsForDate as resolveTargets } from "@maqro/core/targets";
import type { PersonalInfo, TrainingSchedule } from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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
  measurements: [] as BodyMeasurement[],
  overrides: [] as { date: string; day: unknown; recordedAt: number }[],
}));

// The real resolver, observed: the body-fat suite asserts every call's
// context.
vi.mock("@maqro/core/targets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@maqro/core/targets")>();
  return { ...actual, targetsForDate: vi.fn(actual.targetsForDate) };
});

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
    localUserId: "u1",
    isOfflineUnverified: false,
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
    listBodyMeasurements: async () => data.measurements,
    listMicronutrientProfiles: async () => [],
    listBloodPressure: async () => [],
    listWaterIntake: async () => [],
    listDayOverrides: async () => data.overrides,
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
  data.measurements = [];
  data.overrides = [];
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

/** /report resolves targets with the SAME body-fat estimate as the app and
 *  the emails: `latestBodyFatPct` over the WHOLE measurement history (not
 *  the report's window), so a training day's protein never differs. */
describe("/report body fat", () => {
  const measurement = (
    date: string,
    waistCm: number,
    neckCm?: number,
  ): BodyMeasurement => ({ date, waistCm, neckCm, recordedAt: 0 });

  it("passes the latest usable estimate, even from before the window, to every target", async () => {
    const { targetsForDate } = await import("@maqro/core/targets");
    const resolver = vi.mocked(targetsForDate);
    resolver.mockClear();
    data.query = "sections=summary,calories&days=7";
    // The complete reading predates the 7-day window; the newer one is a
    // waist-only check-in.
    data.measurements = [
      measurement("2026-04-01", 88, 38),
      measurement("2026-06-08", 86),
    ];
    fetchMock.mockResolvedValue(usage("free"));
    await renderReport();
    await screen.findByText("Daily kcal vs target of 2600 kcal.");
    const expected = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 88,
      neckCm: 38,
    });
    expect(expected).not.toBeNull();
    // The profile and the measurements load together, so every target the
    // report resolves (today's and each recap day's) carries the estimate.
    expect(resolver.mock.calls.length).toBeGreaterThan(0);
    for (const [, , ctx] of resolver.mock.calls) {
      expect(ctx).toMatchObject({ phasesEnabled: false, bodyFatPct: expected });
    }
  });

  it("the body-composition section and the PDF show that same estimate, with its date", async () => {
    data.query = "sections=summary,body,calories&days=30";
    // The complete reading is inside the window but no longer the latest
    // row: the newer one is a waist-only check-in.
    data.measurements = [
      measurement("2026-05-20", 88, 38),
      measurement("2026-06-08", 86),
    ];
    const expected = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 88,
      neckCm: 38,
    });
    const value = `${expected?.toFixed(1)}%`;
    // The reading's LOCAL calendar day (month index 4 = May).
    const from = new Date(2026, 4, 20).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    const model = (await downloadedModel()) as PdfModel & {
      body: { stats: PdfStat[] };
    };
    const section = screen.getByRole("heading", { name: "Body composition" })
      .parentElement as HTMLElement;
    expect(section.textContent).toContain(value);
    expect(section.textContent).toContain(`from ${from}`);
    const bodyFat = model.body.stats.find((s) => s.label === "Body fat");
    expect(bodyFat?.value).toBe(value);
    expect(bodyFat?.sub).toContain(`from ${from}`);
  });

  it("with nothing measured in the window, shows the older reading, with its date", async () => {
    data.query = "sections=summary,body,calories&days=30";
    // The only complete reading predates the 30-day window.
    data.measurements = [measurement("2026-04-01", 88, 38)];
    const expected = estimateBodyFat({
      bodyType: "male",
      heightCm: 180,
      waistCm: 88,
      neckCm: 38,
    });
    const value = `${expected?.toFixed(1)}%`;
    const from = new Date(2026, 3, 1).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    const model = (await downloadedModel()) as PdfModel & {
      body: { stats: PdfStat[] };
    };
    const section = screen.getByRole("heading", { name: "Body composition" })
      .parentElement as HTMLElement;
    expect(section.textContent).toContain("No measurements in this window");
    expect(section.textContent).toContain(`Latest reading (${from})`);
    expect(section.textContent).toContain("88.0 cm");
    expect(section.textContent).toContain(value);
    // Training is off (the default), so the targets read no body fat: the
    // line must not claim they use this reading.
    expect(section.textContent).not.toContain("your targets use");
    const bodyFat = model.body.stats.find((s) => s.label === "Body fat");
    expect(bodyFat?.value).toBe(value);
    expect(bodyFat?.sub).toContain(`from ${from}`);
    const waist = model.body.stats.find((s) => s.label === "Waist");
    expect(waist?.value).toBe("88.0 cm");
  });

  it("with a training week on, says the targets use that older reading", async () => {
    data.query = "sections=summary,body,calories&days=30";
    data.profile = {
      ...PROFILE,
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
          { type: "rest" },
        ],
      },
    };
    data.measurements = [measurement("2026-04-01", 88, 38)];
    const from = new Date(2026, 3, 1).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    await downloadedModel();
    const section = screen.getByRole("heading", { name: "Body composition" })
      .parentElement as HTMLElement;
    expect(section.textContent).toContain(
      `Latest reading (${from}), which your targets use.`,
    );
  });

  it("with no usable reading anywhere, says nothing was measured in the window", async () => {
    data.query = "sections=summary,body,calories&days=30";
    // A waist-only check-in long ago: no estimate for the targets either.
    data.measurements = [measurement("2026-04-01", 88)];
    const model = (await downloadedModel()) as PdfModel & {
      body: { stats: PdfStat[] };
    };
    const section = screen.getByRole("heading", { name: "Body composition" })
      .parentElement as HTMLElement;
    expect(section.textContent).toContain(
      "No measurements logged in this window.",
    );
    expect(model.body.stats).toEqual([
      { label: "Body", value: "—", sub: "No measurements yet" },
    ]);
  });

  /** A `YYYY-MM-DD` key is a calendar day, not UTC midnight: west of UTC,
   *  parsing it as UTC named the day before (the Progress screen, which
   *  parses it locally, named the right one). */
  describe("west of UTC", () => {
    const savedTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = "America/New_York"; // UTC−4 in May/June
    });
    afterAll(() => {
      process.env.TZ = savedTz;
    });

    const label = (month: number, day: number) =>
      new Date(2026, month, day).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

    it("dates the estimate and the latest measurement by their own calendar day", async () => {
      data.query = "sections=summary,body,calories&days=30";
      data.measurements = [
        measurement("2026-05-20", 88, 38),
        measurement("2026-06-08", 86),
      ];

      const model = (await downloadedModel()) as PdfModel & {
        body: { stats: PdfStat[] };
      };
      const section = screen.getByRole("heading", { name: "Body composition" })
        .parentElement as HTMLElement;
      expect(section.textContent).toContain(`from ${label(4, 20)}`);
      expect(section.textContent).not.toContain(`from ${label(4, 19)}`);
      expect(section.textContent).toContain(
        `Latest measurements (${label(5, 8)})`,
      );
      const bodyFat = model.body.stats.find((s) => s.label === "Body fat");
      expect(bodyFat?.sub).toContain(`from ${label(4, 20)}`);
    });
  });
});

/** The model the report POSTs to the PDF renderer, as far as these tests
 *  read it. */
type PdfStat = { label: string; value: string; sub?: string };
type PdfModel = {
  targets: { stats: PdfStat[] } | null;
  calories: { stats: PdfStat[]; chart: { targetY?: number } | null };
};

/** Render, press Download PDF and return the model POSTed to the server
 *  renderer. */
async function downloadedModel(): Promise<PdfModel> {
  fetchMock.mockImplementation(async (input) =>
    input === "/api/report/pdf" ? new Response("%PDF") : usage("free"),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await renderReport();
  await screen.findByText(/^Daily kcal vs /);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/report/pdf"),
    ).toBe(true),
  );
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/report/pdf");
  const init = (call as unknown as [string, RequestInit])[1];
  return JSON.parse(String(init.body)) as PdfModel;
}

/** With a training week on, today's target is the day's PLANNED share of the
 *  week: averaged intake is compared with the weekly average, and the PDF's
 *  target tile names today's planned day beside that average, so its
 *  figures add up (TDEE + delta = the average). */
describe("/report with a training week", () => {
  const rest = { type: "rest" } as const;
  // 2026-06-10 is a Wednesday: a hard lower-body day, above the average.
  const training: TrainingSchedule = {
    enabled: true,
    cycling: "modest",
    days: [
      rest,
      rest,
      rest,
      { type: "lower", intensity: "hard" },
      rest,
      rest,
      rest,
    ],
  };
  const LINEAR: PersonalInfo = { ...PROFILE, goalPhases: [] };
  const TRAINING: PersonalInfo = { ...LINEAR, training };
  const FREE = { phasesEnabled: false, bodyFatPct: null };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compares the calories with the weekly average and labels today's planned day", async () => {
    data.profile = TRAINING;
    const today = resolveTargets(TRAINING, "2026-06-10", FREE);
    const mean = today.training?.meanCalories ?? 0;
    expect(mean).toBe(2600);
    expect(today.targetCalories).toBeGreaterThan(mean);

    const model = await downloadedModel();
    expect(
      screen.getByText("Daily kcal vs weekly average target of 2600 kcal."),
    ).toBeTruthy();
    expect(model.calories.stats[0]?.sub).toBe("average target 2600 kcal");
    expect(model.calories.chart?.targetY).toBe(2600);
    const tile = model.targets?.stats.find((t) => t.label.startsWith("Today"));
    expect(tile).toEqual({
      label: "Today (planned)",
      value: `${today.targetCalories} kcal`,
      sub: "2600 kcal avg · 0 kcal/day",
    });
    expect(model.targets?.stats.find((t) => t.label === "Target")).toBe(
      undefined,
    );
  });

  it("without training, every figure is today's target as before", async () => {
    data.profile = LINEAR;
    const model = await downloadedModel();
    expect(screen.getByText("Daily kcal vs target of 2600 kcal.")).toBeTruthy();
    expect(model.calories.stats[0]?.sub).toBe("target 2600 kcal");
    expect(model.calories.chart?.targetY).toBe(2600);
    expect(model.targets?.stats.find((t) => t.label === "Target")).toEqual({
      label: "Target",
      value: "2600 kcal",
      sub: "0 kcal/day",
    });
  });
});

/** A per-date session override changes that day's target here exactly as in
 *  the app and the weekly email: the same stored rows, the same resolver. */
describe("/report training day overrides", () => {
  /** Plan targets by training day; Wednesday 2026-06-10 (today) is a hard
   *  lower-body day. */
  const TRAINING: PersonalInfo = {
    ...PROFILE,
    goalPhases: [],
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
        { type: "rest" },
      ],
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("today's target and each recap day follow the stored override", async () => {
    const { targetsForDate, dayOverrideResolver } =
      await import("@maqro/core/targets");
    const rows = [{ date: "2026-06-10", day: { type: "rest" }, recordedAt: 0 }];
    data.profile = TRAINING;
    data.overrides = rows;
    data.query = "sections=summary,calories";
    const free = { phasesEnabled: false, bodyFatPct: null };
    const planned = targetsForDate(TRAINING, "2026-06-10", free);
    const rest = targetsForDate(TRAINING, "2026-06-10", {
      ...free,
      overrideFor: dayOverrideResolver(rows),
    });
    expect(rest.targetCalories).toBeLessThan(planned.targetCalories);
    // Eaten on target for the rest day the user switched to.
    data.logs = [logged("2026-06-10", rest.targetCalories)];
    // Averaged intake is compared with the template week's average, which
    // an override never moves (nothing is rebalanced)…
    const mean = planned.training?.meanCalories;
    expect(rest.training?.meanCalories).toBe(mean);
    const model = await downloadedModel();
    expect(
      screen.getByText(`Daily kcal vs weekly average target of ${mean} kcal.`),
    ).toBeTruthy();
    // …while today's tile and the day's adherence follow the rest day.
    expect(
      model.targets?.stats.find((t) => t.label === "Today (planned)")?.value,
    ).toBe(`${rest.targetCalories} kcal`);
    expect(screen.getByText("100% within ±10%")).toBeTruthy();
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
