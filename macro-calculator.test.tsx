/**
 * @vitest-environment jsdom
 */
import type { AiPlanRequest, AiPlanResult } from "@/lib/ai-plan";
import { computeSlotBudget } from "@/lib/recipe-ranking";
import type { ReactNode, RefObject } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MealSchedule, MealTemplate } from "@maqro/core/records";
import {
  type WeekTargets,
  dayOverrideResolver,
  targetsForDate,
  weekTargets,
} from "@maqro/core/targets";
import type {
  Food,
  FoodItem,
  Meal,
  PersonalInfo,
  Recipe,
  TrainingSchedule,
} from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";

/** The app's wiring: everything on the day view (totals, the meal hub, the
 *  recipe slot budget, and every AI plan payload) must get the SELECTED
 *  date's targets. Today's targets drive only the calculator, Progress and
 *  the phase planner. The children are stubs that record their props, so
 *  this checks exactly what macro-calculator hands each of them. */

const TODAY = "2026-06-10";
const PAST_DAY = "2026-06-03";

/** Linear goal: maintain at 2600. A Pro cut covering 06-01..06-07 (its own
 *  2450 maintenance) puts PAST_DAY at 1900 while TODAY stays at 2600. */
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
      durationWeeks: 1,
      weeklyRateKg: 0.5,
      tdeeOverride: 2450,
    },
  ],
};

const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

/** Props each stubbed child last rendered with, by component name. */
const ui = vi.hoisted(() => {
  const props: Record<string, Record<string, unknown>> = {};
  const stub = (name: string) =>
    function Stub(p: Record<string, unknown>) {
      props[name] = p;
      return null;
    };
  return { props, stub };
});

const refreshAiUsage = vi.hoisted(() => vi.fn());
const requestAiMealPlan = vi.hoisted(() =>
  vi.fn<(req: AiPlanRequest) => Promise<AiPlanResult>>(),
);

/** The URL's query string, and the auth state `useUser` reports (signed in
 *  as u1 unless a test changes it). */
const nav = vi.hoisted(() => ({ search: "view=plan" }));
const SIGNED_IN = {
  user: { id: "u1" } as User,
  localUserId: "u1",
  isOfflineUnverified: false,
  isLoaded: true,
  isUnconfigured: false,
};
const auth = vi.hoisted(() => ({ state: null as unknown }));
/** The stored per-date session overrides' read: settled with no rows unless
 *  a test holds it open (`pending`) to see what runs before it lands. */
const overridesRead = vi.hoisted(() => ({
  pending: null as Promise<
    { date: string; day: unknown; recordedAt: number }[]
  > | null,
}));
/** The day's meal slots `useDailyLog` reports, when a test renames them or
 *  gives a date its own. `loaded`, when set, lists the dates whose log has
 *  loaded: any other date reports `isHydrated: false` and still holds the
 *  last loaded day's meals, as the real hook does across a date switch. */
const dayMeals = vi.hoisted(() => ({
  override: null as Meal[] | null,
  byDate: {} as Record<string, Meal[]>,
  loaded: null as Set<string> | null,
  last: null as Meal[] | null,
}));

/** The day view's meal writes (`useDailyLog`'s `setMeals`), and the
 *  recipes `listRecipes` serves (none unless a test adds some). */
const writes = vi.hoisted(() => ({
  setMeals: vi.fn<(meals: Meal[]) => void>(),
  recipes: [] as Recipe[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("./hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: "pro", resolved: true }),
  useRefreshAiUsage: () => refreshAiUsage,
}));
vi.mock("./hooks/use-user", () => ({ useUser: () => auth.state }));
const patchProfile = vi.hoisted(() => vi.fn());
/** The profile `useProfile` serves: PROFILE unless a test swaps it. */
const stored = vi.hoisted(() => ({ profile: null as PersonalInfo | null }));
vi.mock("./hooks/use-profile", () => ({
  useProfile: () => ({
    profile: stored.profile ?? PROFILE,
    setProfile: vi.fn(),
    patchProfile,
    isHydrated: true,
  }),
}));
vi.mock("./hooks/use-daily-log", () => ({
  useDailyLog: (date: string) => {
    const own = dayMeals.byDate[date] ?? dayMeals.override ?? MEALS;
    const isHydrated = dayMeals.loaded?.has(date) ?? true;
    if (isHydrated) dayMeals.last = own;
    return {
      date,
      meals: isHydrated ? own : (dayMeals.last ?? own),
      setMeals: writes.setMeals,
      isHydrated,
      day: { date, epoch: 0 },
      commitToDay: async () => true,
    };
  },
}));
vi.mock("./hooks/use-food-search", () => ({
  useFoodSearch: () => ({ results: [], isSearchingRemote: false }),
}));
vi.mock("./hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./lib/ai-plan", () => ({ requestAiMealPlan }));
vi.mock("./lib/db", async (importOriginal) => ({
  // The real `todayKey` (local day off the faked clock) and pure helpers;
  // every IndexedDB read the component makes is served empty.
  ...(await importOriginal<typeof import("./lib/db")>()),
  listCustomFoods: async () => [],
  listDailyLogs: async () => [],
  listDayOverrides: () => overridesRead.pending ?? Promise.resolve([]),
  listMealSchedules: async () => [],
  listMicronutrientProfiles: async () => [],
  listPantryItems: async () => [],
  listRecipes: async () => writes.recipes,
}));

vi.mock("./components/shell/AppShell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => {
    ui.props.AppShell = props;
    return children;
  },
}));
vi.mock("./components/auth/SignInPromptDialog", () => ({
  SignInPromptDialog: ui.stub("SignInPromptDialog"),
}));
vi.mock("./components/onboarding/OnboardingWizard", () => ({
  OnboardingWizard: ui.stub("OnboardingWizard"),
}));
vi.mock("./components/macro/AdvancedSettingsSection", () => ({
  AdvancedSettingsSection: ui.stub("AdvancedSettingsSection"),
}));
vi.mock("./components/macro/ApplyRecipeDialog", () => ({
  ApplyRecipeDialog: ui.stub("ApplyRecipeDialog"),
}));
vi.mock("./components/macro/ApplyTemplateDialog", () => ({
  ApplyTemplateDialog: ui.stub("ApplyTemplateDialog"),
}));
vi.mock("./components/macro/BodySummaryStrip", () => ({
  BodySummaryStrip: ui.stub("BodySummaryStrip"),
}));
vi.mock("./components/macro/CameraSheet", () => ({
  CameraSheet: ui.stub("CameraSheet"),
}));
vi.mock("./components/macro/CustomFoodForm", () => ({
  CustomFoodForm: ui.stub("CustomFoodForm"),
}));
vi.mock("./components/macro/FastingView", () => ({
  FastingView: ui.stub("FastingView"),
}));
vi.mock("./components/macro/FoodSearchSheet", () => ({
  FoodSearchSheet: ui.stub("FoodSearchSheet"),
}));
vi.mock("./components/macro/GoalPhasesPlanner", () => ({
  GoalPhasesPlanner: ui.stub("GoalPhasesPlanner"),
}));
vi.mock("./components/macro/LogMealSheet", () => ({
  LogMealSheet: ui.stub("LogMealSheet"),
}));
vi.mock("./components/macro/MacroResults", () => ({
  default: ui.stub("MacroResults"),
}));
vi.mock("./components/macro/MealHubSheet", () => ({
  MealHubSheet: ui.stub("MealHubSheet"),
}));
vi.mock("./components/macro/MealPhotoReviewDialog", () => ({
  MealPhotoReviewDialog: ui.stub("MealPhotoReviewDialog"),
}));
vi.mock("./components/macro/MealPlanner", () => ({
  default: ui.stub("MealPlanner"),
}));
vi.mock("./components/macro/MyFoodsView", () => ({
  MyFoodsView: ui.stub("MyFoodsView"),
}));
vi.mock("./components/macro/PairPhoneDialog", () => ({
  PairPhoneDialog: ui.stub("PairPhoneDialog"),
}));
vi.mock("./components/macro/PantryView", () => ({
  PantryView: ui.stub("PantryView"),
}));
vi.mock("./components/macro/PersonalInfoForm", () => ({
  default: ui.stub("PersonalInfoForm"),
}));
vi.mock("./components/macro/ProfileView", () => ({
  ProfileView: ui.stub("ProfileView"),
}));
vi.mock("./components/macro/ProgressView", () => ({
  ProgressView: ui.stub("ProgressView"),
}));
vi.mock("./components/macro/RecipesView", () => ({
  RecipesView: ui.stub("RecipesView"),
}));
vi.mock("./components/macro/SaveTemplateDialog", () => ({
  SaveTemplateDialog: ui.stub("SaveTemplateDialog"),
}));
vi.mock("./components/macro/SettingsView", () => ({
  SettingsView: ui.stub("SettingsView"),
}));
vi.mock("./components/macro/DayTypeSheet", () => ({
  DayTypeSheet: ui.stub("DayTypeSheet"),
}));
vi.mock("./components/macro/ShoppingListView", () => ({
  ShoppingListView: ui.stub("ShoppingListView"),
}));
vi.mock("./components/macro/SuggestDayDialog", () => ({
  SuggestDayDialog: ui.stub("SuggestDayDialog"),
}));
vi.mock("./components/macro/SupplementsSection", () => ({
  SupplementsSection: ui.stub("SupplementsSection"),
}));
vi.mock("./components/macro/TemplatesView", () => ({
  TemplatesView: ui.stub("TemplatesView"),
}));
// Two instances render side by side (the URL-driven one, reason
// "settings", and the AI-cap one), so each records under its reason:
// `UpgradeDialog:settings`, `UpgradeDialog:ai-cap`.
vi.mock("./components/macro/UpgradeDialog", () => ({
  UpgradeDialog: (p: Record<string, unknown>) =>
    ui.stub(`UpgradeDialog:${String(p.reason)}`)(p),
}));
vi.mock("./components/macro/VoiceLogSheet", () => ({
  VoiceLogSheet: ui.stub("VoiceLogSheet"),
}));

const { default: MacroCalculator } = await import("./macro-calculator");
const { formatDayLabel } = await import("./lib/today/day-label");
const { railNodes } = await import("./lib/today/rail");

/** A prop the stubbed `component` last rendered with. */
function prop<T>(component: string, name: string): T {
  const props = ui.props[component];
  if (!props) throw new Error(`${component} never rendered`);
  return props[name] as T;
}

const pro = { phasesEnabled: true };
const todayTargets = targetsForDate(PROFILE, TODAY, pro);
const pastTargets = targetsForDate(PROFILE, PAST_DAY, pro);

const macros = (t: typeof pastTargets) => ({
  protein: t.protein,
  carbs: t.carbs,
  fat: t.fat,
  calories: t.targetCalories,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
  nav.search = "view=plan";
  stored.profile = null;
  auth.state = SIGNED_IN;
  dayMeals.override = null;
  dayMeals.byDate = {};
  dayMeals.loaded = null;
  dayMeals.last = null;
  overridesRead.pending = null;
  writes.setMeals.mockReset();
  writes.recipes = [];
  for (const key of Object.keys(ui.props)) delete ui.props[key];
  refreshAiUsage.mockReset();
  requestAiMealPlan.mockReset();
  requestAiMealPlan.mockResolvedValue({
    kind: "ok",
    meals: MEALS.map((m) => ({ ...m, foods: [] })),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderOnPastDay() {
  render(<MacroCalculator />);
  // Sanity: the fixture really does differ between the two days, and the
  // day view starts on today.
  expect(pastTargets.targetCalories).toBe(1900);
  expect(todayTargets.targetCalories).toBe(2600);
  expect(prop("MealPlanner", "calculatedValues")).toEqual(todayTargets);

  await act(async () => {
    prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
  });
  expect(prop("MealPlanner", "selectedDate")).toBe(PAST_DAY);
}

describe("macro-calculator: the day view gets the selected date's targets", () => {
  it("totals, meal hub and the recipe slot budget", async () => {
    await renderOnPastDay();

    expect(prop("MealPlanner", "calculatedValues")).toEqual(pastTargets);
    expect(prop("MealHubSheet", "goal")).toEqual({
      calories: pastTargets.targetCalories,
      protein: pastTargets.protein,
      carbs: pastTargets.carbs,
      fat: pastTargets.fat,
    });
    expect(prop("ApplyRecipeDialog", "slotBudget")).toEqual(
      computeSlotBudget(
        {
          protein: pastTargets.protein,
          carbs: pastTargets.carbs,
          fat: pastTargets.fat,
        },
        MEALS.length,
      ),
    );
  });

  it("suggest-day is asked against the selected day's target", async () => {
    await renderOnPastDay();
    await act(async () => {
      prop<() => void>("MealPlanner", "onOpenSuggestDay")();
    });
    expect(prop("SuggestDayDialog", "target")).toEqual(macros(pastTargets));
  });

  it("auto-fill, refine and regenerate send the selected day's target and refresh usage on success", async () => {
    await renderOnPastDay();

    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
    });
    await act(async () => {
      await prop<(r: string) => Promise<void>>(
        "MealPlanner",
        "onRefineMealPlan",
      )("more protein");
    });
    await act(async () => {
      await prop<(id: number) => Promise<void>>(
        "MealPlanner",
        "onRegenerateMeal",
      )(1);
    });

    expect(requestAiMealPlan).toHaveBeenCalledTimes(3);
    for (const [req] of requestAiMealPlan.mock.calls) {
      expect(req.targets).toEqual(macros(pastTargets));
    }
    // Each successful (debited) AI call refreshes the shared usage counter.
    expect(refreshAiUsage).toHaveBeenCalledTimes(3);
  });

  it("the session chip opens the day-type sheet for the shown day", async () => {
    await renderOnPastDay();
    // One entry point: no interim session row next to the chip.
    expect(ui.props.MealPlanner).not.toHaveProperty("sessionRow");
    expect(ui.props.DayTypeSheet).toBeUndefined();

    const chip = document.createElement("button");
    await act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "MealPlanner",
        "onEditDayType",
      )(chip);
    });

    expect(prop("DayTypeSheet", "targets")).toEqual(pastTargets);
    expect(prop("DayTypeSheet", "today")).toBe(TODAY);
    // Back to plan for the shown day: the same resolver and tier context.
    expect(
      prop<(d: string, day: null) => unknown>(
        "DayTypeSheet",
        "previewDayTargets",
      )(PAST_DAY, null),
    ).toEqual(pastTargets);
    // Focus goes back to the chip that opened it.
    expect(
      prop<RefObject<HTMLElement | null>>("DayTypeSheet", "returnFocusTo")
        .current,
    ).toBe(chip);

    const onOpenChange = prop<(open: boolean) => void>(
      "DayTypeSheet",
      "onOpenChange",
    );
    delete ui.props.DayTypeSheet;
    await act(async () => onOpenChange(false));
    expect(ui.props.DayTypeSheet).toBeUndefined();
  });

  /** Open the sheet from the chip, then forget what it rendered so far: a
   *  later `ui.props.DayTypeSheet` means it rendered again. */
  const openDayTypeSheet = async () => {
    await act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "MealPlanner",
        "onEditDayType",
      )(document.createElement("button"));
    });
    expect(ui.props.DayTypeSheet).toBeDefined();
    delete ui.props.DayTypeSheet;
  };

  it("leaving Today closes the sheet: coming back never reopens it", async () => {
    await renderOnPastDay();
    await openDayTypeSheet();

    await act(async () => {
      prop<(k: string) => void>("AppShell", "onSelect")("progress");
    });
    expect(ui.props.DayTypeSheet).toBeUndefined();
    // Back on Today (now on today's date, the nav resets it): no sheet
    // popping open unprompted, for today or for the day it was opened on.
    await act(async () => {
      prop<(k: string) => void>("AppShell", "onSelect")("plan");
    });
    expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
    expect(ui.props.DayTypeSheet).toBeUndefined();
    await act(async () => {
      prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
    });
    expect(ui.props.DayTypeSheet).toBeUndefined();
  });

  it.each([
    [
      "the date navigator",
      () => prop<(d: string) => void>("MealPlanner", "onSelectDate")(TODAY),
    ],
    [
      "the nav's Today (command palette)",
      () => prop<(k: string) => void>("AppShell", "onSelect")("plan"),
    ],
  ])(
    "the shown date changing (%s) closes the sheet opened on a past day",
    async (_, selectToday) => {
      await renderOnPastDay();
      await openDayTypeSheet();

      await act(async () => selectToday());
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
      // Never the past day's draft over today's targets.
      expect(ui.props.DayTypeSheet).toBeUndefined();
      // And it stays closed going back to the day it was opened on.
      await act(async () => {
        prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
      });
      expect(ui.props.DayTypeSheet).toBeUndefined();
    },
  );

  it("a stale sheet's close never closes the sheet opened after it", async () => {
    const { rerender } = render(<MacroCalculator />);
    await act(async () => {
      prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
    });
    await act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "MealPlanner",
        "onEditDayType",
      )(document.createElement("button"));
    });
    // The past day's sheet, e.g. with its save still in flight.
    const staleClose = prop<(open: boolean) => void>(
      "DayTypeSheet",
      "onOpenChange",
    );
    // The shown date moves on (closing it), and the user opens the sheet
    // again for the new day before the stale save settles.
    await act(async () => {
      prop<(d: string) => void>("MealPlanner", "onSelectDate")(TODAY);
    });
    await act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "MealPlanner",
        "onEditDayType",
      )(document.createElement("button"));
    });
    expect(prop("DayTypeSheet", "targets")).toEqual(todayTargets);
    const ownClose = prop<(open: boolean) => void>(
      "DayTypeSheet",
      "onOpenChange",
    );

    // The stale save settles and closes ITS sheet: today's stays open.
    await act(async () => staleClose(false));
    delete ui.props.DayTypeSheet;
    rerender(<MacroCalculator />);
    expect(prop("DayTypeSheet", "targets")).toEqual(todayTargets);

    // Its own close still closes it.
    await act(async () => ownClose(false));
    delete ui.props.DayTypeSheet;
    rerender(<MacroCalculator />);
    expect(ui.props.DayTypeSheet).toBeUndefined();
  });

  it("midnight, while following today, closes the sheet opened for that day", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 5, 10, 23, 59, 0));
    render(<MacroCalculator />);
    await openDayTypeSheet();

    // useToday's midnight timer fires: the day view follows to the new day.
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(prop("MealPlanner", "selectedDate")).toBe("2026-06-11");
    expect(ui.props.DayTypeSheet).toBeUndefined();
  });

  it("nothing plans with AI or suggests against the template day until the overrides have loaded", async () => {
    // Every day a hard lower-body session; today stored as a rest day.
    const lower = { type: "lower", intensity: "hard" } as const;
    const training: TrainingSchedule = {
      enabled: true,
      days: [lower, lower, lower, lower, lower, lower, lower],
      cycling: "modest",
    };
    stored.profile = { ...PROFILE, training };
    const rows = [{ date: TODAY, day: { type: "rest" }, recordedAt: 0 }];
    let land: (r: typeof rows) => void = () => {};
    overridesRead.pending = new Promise((resolve) => {
      land = resolve;
    });
    const template = targetsForDate(stored.profile, TODAY, pro);
    const restDay = targetsForDate(stored.profile, TODAY, {
      ...pro,
      bodyFatPct: null,
      overrideFor: dayOverrideResolver(rows),
    });
    expect(restDay.targetCalories).toBeLessThan(template.targetCalories);

    render(<MacroCalculator />);
    // Still loading: no AI request, no suggestion dialog, no slot budget
    // or meal-insight goal built on the template day.
    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
      await prop<(r: string) => Promise<void>>(
        "MealPlanner",
        "onRefineMealPlan",
      )("more protein");
      await prop<(id: number) => Promise<void>>(
        "MealPlanner",
        "onRegenerateMeal",
      )(1);
      prop<() => void>("MealPlanner", "onOpenSuggestDay")();
    });
    expect(requestAiMealPlan).not.toHaveBeenCalled();
    expect(ui.props.SuggestDayDialog).toBeUndefined();
    expect(prop("ApplyRecipeDialog", "slotBudget")).toBeUndefined();
    expect(prop("MealHubSheet", "goal")).toBeUndefined();
    expect(prop<string>("MealPlanner", "mealPlanMessage")).toMatch(
      /still loading/i,
    );

    // Loaded: the suggestion asked for opens against today's real session,
    // and AI plans use it.
    await act(async () => {
      land(rows);
    });
    expect(prop("SuggestDayDialog", "target")).toEqual(macros(restDay));
    expect(prop("MealHubSheet", "goal")).toEqual({
      calories: restDay.targetCalories,
      protein: restDay.protein,
      carbs: restDay.carbs,
      fat: restDay.fat,
    });
    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
    });
    expect(requestAiMealPlan).toHaveBeenCalledTimes(1);
    expect(requestAiMealPlan.mock.calls[0]?.[0].targets).toEqual(
      macros(restDay),
    );
  });

  it("an AI call that is not debited does not refresh usage", async () => {
    requestAiMealPlan.mockResolvedValue({
      kind: "cap-reached",
      used: 10,
      cap: 10,
    });
    await renderOnPastDay();
    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
    });
    expect(requestAiMealPlan).toHaveBeenCalledTimes(1);
    expect(refreshAiUsage).not.toHaveBeenCalled();
  });
});

describe("macro-calculator: Today-first landing", () => {
  /** Which of the day view / calculator rendered. */
  const rendered = () => ({
    today: "MealPlanner" in ui.props,
    calculator: "MacroResults" in ui.props,
  });

  it.each(["", "view=today", "view=plan", "view=bogus", "view=__proto__"])(
    "%j opens Today (the day view)",
    (search) => {
      nav.search = search;
      render(<MacroCalculator />);
      expect(rendered()).toEqual({ today: true, calculator: false });
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
    },
  );

  it("?view=calculator still opens the calculator", () => {
    nav.search = "view=calculator";
    render(<MacroCalculator />);
    expect(rendered()).toEqual({ today: false, calculator: true });
  });

  it("?upgrade= opens over Today", () => {
    nav.search = "upgrade=pro";
    render(<MacroCalculator />);
    expect(rendered().today).toBe(true);
    // The URL-driven dialog, open on the plan the link names — not the
    // AI-cap one, which stays closed.
    expect(prop("UpgradeDialog:settings", "open")).toBe(true);
    expect(prop("UpgradeDialog:settings", "defaultPlan")).toBe("pro");
    expect(prop("UpgradeDialog:ai-cap", "open")).toBe(false);
  });

  it("finishing onboarding lands on Today even from another view", async () => {
    nav.search = "view=calculator";
    render(<MacroCalculator />);
    await act(async () => {
      prop<(r: { profile: PersonalInfo | null; skipped: boolean }) => void>(
        "OnboardingWizard",
        "onFinish",
      )({ profile: PROFILE, skipped: false });
    });
    expect(rendered().today).toBe(true);
  });
});

describe("macro-calculator: the day view's heading names the day it shows", () => {
  it("leaves the heading to the day's own header; the launcher names the day", async () => {
    render(<MacroCalculator />);
    // No second title in the top bar: the Today header is the page's h1.
    expect(prop("AppShell", "title")).toBeNull();
    expect(prop("LogMealSheet", "dayLabel")).toBe("Today");

    await act(async () => {
      prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
    });
    const pastLabel = formatDayLabel(PAST_DAY, TODAY);
    expect(pastLabel).not.toBe("Today");
    expect(prop("AppShell", "title")).toBeNull();
    expect(prop("LogMealSheet", "dayLabel")).toBe(pastLabel);
  });

  describe("choosing Today in the shell's nav shows today", () => {
    const selectToday = async () => {
      await act(async () => {
        prop<(k: string) => void>("AppShell", "onSelect")("plan");
      });
    };

    it("re-tapping the active Today on a past day returns to today", async () => {
      await renderOnPastDay();
      expect(prop("AppShell", "current")).toBe("plan");
      await selectToday();
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
      expect(prop("AppShell", "title")).toBeNull();
    });

    it("coming back from another view lands on today, not the past day", async () => {
      await renderOnPastDay();
      await act(async () => {
        prop<(k: string) => void>("AppShell", "onSelect")("progress");
      });
      expect(prop("AppShell", "current")).toBe("progress");
      await selectToday();
      expect(prop("AppShell", "current")).toBe("plan");
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
      expect(prop("AppShell", "title")).toBeNull();
    });
  });

  it("other views keep their registry title", () => {
    nav.search = "view=progress";
    render(<MacroCalculator />);
    expect(prop("AppShell", "title")).toBeUndefined();
  });
});

describe("macro-calculator: quick add (the tab bar's centre [+])", () => {
  /** Taps the [+] (the tab bar hands over the button it rendered). */
  const quickAdd = async (plus = document.createElement("button")) => {
    await act(async () => {
      prop<(trigger: HTMLElement) => void>("AppShell", "onQuickAdd")(plus);
    });
  };
  const launcher = () => ({
    open: prop<boolean>("LogMealSheet", "open"),
    mealId: prop<number | null>("LogMealSheet", "initialMealId"),
    dayLabel: prop<string>("LogMealSheet", "dayLabel"),
  });

  it("at noon on Today opens the launcher at Lunch · Today", async () => {
    nav.search = "";
    render(<MacroCalculator />);
    expect(launcher().open).toBe(false);
    await quickAdd();
    expect(launcher()).toEqual({ open: true, mealId: 2, dayLabel: "Today" });
  });

  it.each([
    [8, 0, 1],
    [19, 30, 3],
    [23, 30, 4],
    [1, 0, 4],
  ])("at %i:%i targets meal %i", async (h, m, mealId) => {
    vi.setSystemTime(new Date(2026, 5, 10, h, m, 0));
    render(<MacroCalculator />);
    await quickAdd();
    expect(launcher().mealId).toBe(mealId);
  });

  it("slots whose names don't map start at the meal step", async () => {
    dayMeals.override = [
      { id: 1, name: "Meal 1", foods: [] },
      { id: 2, name: "Meal 2", foods: [] },
    ];
    render(<MacroCalculator />);
    await quickAdd();
    expect(launcher()).toEqual({ open: true, mealId: null, dayLabel: "Today" });
  });

  it("from another tab, switches to Today first", async () => {
    nav.search = "view=progress";
    render(<MacroCalculator />);
    expect("MealPlanner" in ui.props).toBe(false);
    await quickAdd();
    expect(prop("AppShell", "current")).toBe("plan");
    expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
    expect(launcher()).toEqual({ open: true, mealId: 2, dayLabel: "Today" });
  });

  it("from a past day, comes back to today before logging", async () => {
    await renderOnPastDay();
    await quickAdd();
    expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
    expect(launcher()).toEqual({ open: true, mealId: 2, dayLabel: "Today" });
  });

  describe("while today's log is still loading", () => {
    /** On PAST_DAY, whose slots have their own ids, with today's log not
     *  loaded yet. */
    async function onPastDayBeforeTodayLoads() {
      dayMeals.byDate[PAST_DAY] = MEALS.map((m) => ({ ...m, id: m.id + 10 }));
      const view = render(<MacroCalculator />);
      await act(async () => {
        prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY);
      });
      dayMeals.loaded = new Set([PAST_DAY]);
      view.rerender(<MacroCalculator />);
      return view;
    }

    it("waits for today's slots, then targets today's", async () => {
      const view = await onPastDayBeforeTodayLoads();
      expect(prop("AppShell", "quickAddPending")).toBe(false);
      await quickAdd();
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
      // Still showing the past day's slots: no launcher yet, and the [+]
      // says it is working on it.
      expect(launcher().open).toBe(false);
      expect(prop("AppShell", "quickAddPending")).toBe(true);

      dayMeals.loaded?.add(TODAY);
      view.rerender(<MacroCalculator />);
      expect(launcher()).toEqual({ open: true, mealId: 2, dayLabel: "Today" });
      expect(prop("AppShell", "quickAddPending")).toBe(false);
    });

    it.each([
      [
        "another view",
        () => prop<(k: string) => void>("AppShell", "onSelect")("progress"),
      ],
      [
        "another day",
        () =>
          prop<(d: string) => void>("MealPlanner", "onSelectDate")(PAST_DAY),
      ],
    ])("leaving for %s drops the request", async (_, leave) => {
      const view = await onPastDayBeforeTodayLoads();
      await quickAdd();
      await act(async () => {
        leave();
      });
      dayMeals.loaded?.add(TODAY);
      view.rerender(<MacroCalculator />);
      // Back on Today, loaded: nothing pops open unprompted.
      await act(async () => {
        prop<(k: string) => void>("AppShell", "onSelect")("plan");
      });
      await act(async () => {
        prop<(d: string) => void>("MealPlanner", "onSelectDate")(TODAY);
      });
      expect(prop("MealPlanner", "selectedDate")).toBe(TODAY);
      expect(launcher().open).toBe(false);
    });
  });

  it("a method hands off to its tool, whose Back returns to the method step", async () => {
    render(<MacroCalculator />);
    await quickAdd();
    await act(async () => {
      prop<(m: string, id: number) => void>("LogMealSheet", "onMethod")(
        "search",
        2,
      );
    });
    expect(launcher().open).toBe(false);
    expect(prop("FoodSearchSheet", "open")).toBe(true);
    expect(prop("FoodSearchSheet", "mealId")).toBe(2);
    await act(async () => {
      prop<() => void>("FoodSearchSheet", "onBack")();
    });
    expect(launcher()).toEqual({ open: true, mealId: 2, dayLabel: "Today" });
  });

  it("the launcher returns focus to the [+] that opened it", async () => {
    render(<MacroCalculator />);
    const plus = document.createElement("button");
    await quickAdd(plus);
    expect(
      prop<RefObject<HTMLElement | null>>("LogMealSheet", "returnFocusTo")
        .current,
    ).toBe(plus);
  });

  it("dismissing the launcher ends the quick add", async () => {
    render(<MacroCalculator />);
    await quickAdd();
    await act(async () => {
      prop<(o: boolean) => void>("LogMealSheet", "onOpenChange")(false);
    });
    expect(launcher().open).toBe(false);
    expect(launcher().mealId).toBeNull();
  });

  it("the day view has no floating add button of its own any more", () => {
    render(<MacroCalculator />);
    expect(prop("MealPlanner", "onOpenLogMeal")).toBeUndefined();
    expect(prop("MealPlanner", "onOpenPhoto")).toBeUndefined();
  });
});

/** The Training week editor (inside ProfileView) persists through the
 *  profile payload — `patchProfile("training" | "proteinSetting", …)`, no
 *  migration — and plans with the same target context as the app. */
describe("macro-calculator: training week wiring", () => {
  it("persists the template and the protein setting, and plans through useTargets", () => {
    patchProfile.mockReset();
    nav.search = "view=profile";
    render(<MacroCalculator />);

    const schedule = {
      enabled: true,
      cycling: "modest" as const,
      days: Array.from({ length: 7 }, () => ({ type: "rest" as const })),
    };
    act(() => {
      prop<(next: unknown) => void>(
        "ProfileView",
        "onTrainingChange",
      )(schedule);
    });
    expect(patchProfile).toHaveBeenCalledWith("training", schedule);

    const setting = { basis: "leanMass" as const, gPerKg: 2.4 };
    act(() => {
      prop<(next: unknown) => void>(
        "ProfileView",
        "onProteinSettingChange",
      )(setting);
    });
    expect(patchProfile).toHaveBeenCalledWith("proteinSetting", setting);

    const planWeek = prop<(p: PersonalInfo) => WeekTargets | null>(
      "ProfileView",
      "planWeek",
    );
    expect(planWeek(PROFILE)).toEqual(weekTargets(PROFILE, TODAY, pro));
  });
});

describe("macro-calculator: the Calculator's Edit week link", () => {
  it("opens the training week; the next visit to the profile opens its hub", () => {
    nav.search = "view=calculator";
    render(<MacroCalculator />);
    expect("ProfileView" in ui.props).toBe(false);
    act(() => {
      prop<() => void>("MacroResults", "onEditWeek")();
    });
    expect(prop("ProfileView", "initialSub")).toBe("training");

    // Leaving and coming back through the nav lands on the hub again.
    act(() => {
      prop<(k: string) => void>("AppShell", "onSelect")("calculator");
    });
    act(() => {
      prop<(k: string) => void>("AppShell", "onSelect")("profile");
    });
    expect(prop("ProfileView", "initialSub")).toBe("home");
  });
});

/** Progress compares AVERAGED intake with a target: with a training week on
 *  that is the weekly average, not today's planned day (which sits above or
 *  below it). Without one, exactly today's target as before. */
describe("macro-calculator: Progress averages against the weekly average", () => {
  it("passes the training week's average beside today's planned day", () => {
    // 2026-06-10 is a Wednesday: a hard lower-body day plans above the mean.
    const rest = { type: "rest" } as const;
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
    const profile: PersonalInfo = { ...PROFILE, goalPhases: [], training };
    stored.profile = profile;
    const planned = targetsForDate(profile, TODAY, pro);
    const mean = planned.training?.meanCalories ?? 0;
    expect(planned.targetCalories).toBeGreaterThan(mean);
    nav.search = "view=progress";
    render(<MacroCalculator />);
    expect(prop("ProgressView", "targetCalories")).toBe(planned.targetCalories);
    expect(prop("ProgressView", "weeklyAverageCalories")).toBe(mean);
  });

  it("without training, Progress gets today's target and no average", () => {
    nav.search = "view=progress";
    render(<MacroCalculator />);
    expect(prop("ProgressView", "targetCalories")).toBe(2600);
    expect(prop("ProgressView", "weeklyAverageCalories")).toBeUndefined();
  });
});

describe("macro-calculator: ?upgrade=<plan>", () => {
  const APP_URL = "http://localhost:3000/app?upgrade=pro";

  /** Renders with `?upgrade=pro` and returns the (stubbed) location, whose
   *  `href` a redirect would overwrite. */
  function renderWithUpgradeParam() {
    nav.search = "upgrade=pro";
    const location = { ...window.location, href: APP_URL };
    vi.stubGlobal("location", location);
    render(<MacroCalculator />);
    return location;
  }

  it("offline-unverified: stays on the page and explains, no /login bounce", () => {
    auth.state = { ...SIGNED_IN, user: null, isOfflineUnverified: true };
    const info = vi.spyOn(toast, "info");
    const location = renderWithUpgradeParam();

    expect(location.href).toBe(APP_URL);
    expect(info).toHaveBeenCalledWith(
      "Can't reach the account server — your data stays on this device. The upgrade opens once it can be reached.",
    );
  });

  it("signed out: bounces to /login and back to the upgrade", () => {
    auth.state = { ...SIGNED_IN, user: null, localUserId: null };
    const location = renderWithUpgradeParam();
    expect(location.href).toBe(
      `/login?next=${encodeURIComponent("/app?upgrade=pro")}`,
    );
  });

  it("signed in: no redirect (the upgrade dialog opens in place)", () => {
    const info = vi.spyOn(toast, "info");
    const location = renderWithUpgradeParam();
    expect(location.href).toBe(APP_URL);
    expect(info).not.toHaveBeenCalled();
  });
});

describe("macro-calculator: every way of logging food times it on today", () => {
  /** The faked clock (12:00 on TODAY): when food logged now was eaten. */
  const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
  const OATS = {
    foodName: "Oats",
    macrosPer100g: { protein: 13, carbs: 60, fat: 7, calories: 380 },
    portionGrams: 80,
  };
  const RECIPE: Recipe = {
    id: "r1",
    name: "Porridge",
    ingredients: [OATS],
    createdAt: 0,
    updatedAt: 0,
  };
  const TEMPLATE: MealTemplate = {
    id: "t1",
    name: "Usual lunch",
    // A saved template's food keeps no time of its own.
    foods: [
      {
        id: 7,
        name: "Rice",
        protein: 3,
        carbs: 28,
        fat: 0,
        calories: 130,
        portionSize: 100,
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
  const SCHEDULE: MealSchedule = {
    id: "s1",
    recipeId: RECIPE.id,
    recipeName: RECIPE.name,
    mealNames: ["lunch"],
    startDate: PAST_DAY,
    endDate: TODAY,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    scale: 1,
    createdAt: 0,
    updatedAt: 0,
  };
  const PHOTO_FOOD: FoodItem = {
    id: 1,
    name: "Salad",
    protein: 4,
    carbs: 10,
    fat: 8,
    calories: 130,
    portionSize: 200,
  };

  /** Each path the UI presents as logging, into Lunch (id 2). */
  const PATHS: { name: string; log: () => Promise<void> }[] = [
    {
      name: "a recipe from the log launcher",
      log: async () => {
        await act(async () => {
          prop<(m: string, id: number) => void>("LogMealSheet", "onMethod")(
            "recipe",
            2,
          );
        });
        await act(async () => {
          prop<(r: Recipe) => void>("ApplyRecipeDialog", "onApply")(RECIPE);
        });
      },
    },
    {
      name: "a template from the log launcher",
      log: async () => {
        await act(async () => {
          prop<(m: string, id: number) => void>("LogMealSheet", "onMethod")(
            "template",
            2,
          );
        });
        await act(async () => {
          prop<(t: MealTemplate) => void>(
            "ApplyTemplateDialog",
            "onApply",
          )(TEMPLATE);
        });
      },
    },
    {
      name: "a scheduled recipe's 'Log'",
      log: async () => {
        writes.recipes = [RECIPE];
        await act(async () => {
          await prop<(s: MealSchedule, id: number) => Promise<void>>(
            "MealPlanner",
            "onLogScheduled",
          )(SCHEDULE, 2);
        });
      },
    },
    {
      name: "the day suggester's 'Log this day'",
      log: async () => {
        await act(async () => {
          prop<() => void>("MealPlanner", "onOpenSuggestDay")();
        });
        await act(async () => {
          prop<(picks: { recipe: Recipe; mealId: number }[]) => void>(
            "SuggestDayDialog",
            "onApplyDay",
          )([{ recipe: RECIPE, mealId: 2 }]);
        });
      },
    },
    {
      name: "confirming a meal photo's foods",
      log: async () => {
        await act(async () => {
          prop<(id: number, foods: FoodItem[], custom: unknown[]) => void>(
            "MealPhotoReviewDialog",
            "onConfirm",
          )(2, [PHOTO_FOOD], []);
        });
      },
    },
  ];

  /** The day view's last meal write. */
  function written(): Meal[] {
    const meals = writes.setMeals.mock.lastCall?.[0];
    if (!meals) throw new Error("nothing was written");
    return meals;
  }

  /** Lunch's foods in the day view's last meal write. */
  function writtenLunch(): FoodItem[] {
    const lunch = written().find((m) => m.id === 2);
    if (!lunch) throw new Error("no Lunch in the write");
    return lunch.foods;
  }

  for (const path of PATHS) {
    it(`${path.name} is eaten now on today, and untimed on another day`, async () => {
      render(<MacroCalculator />);
      await path.log();
      const today = writtenLunch();
      expect(today.length).toBeGreaterThan(0);
      for (const food of today) expect(food.loggedAt).toBe(NOW);
      // So the rail reads the meal as logged, not planned.
      expect(railNodes(written(), "today")[1]?.node).toBe("logged");

      cleanup();
      writes.setMeals.mockReset();
      await renderOnPastDay();
      await path.log();
      const past = writtenLunch();
      expect(past.length).toBeGreaterThan(0);
      for (const food of past) expect(food.loggedAt).toBeUndefined();
    });
  }

  it("replacing a food keeps the time it was eaten", async () => {
    const EATEN_AT = new Date(2026, 5, 10, 8, 30).getTime();
    const eggs: FoodItem = {
      id: 11,
      name: "Eggs",
      protein: 13,
      carbs: 1,
      fat: 10,
      calories: 150,
      portionSize: 100,
      loggedAt: EATEN_AT,
    };
    dayMeals.override = MEALS.map((m) =>
      m.id === 2 ? { ...m, foods: [eggs] } : m,
    );
    render(<MacroCalculator />);
    await act(async () => {
      prop<(mealId: number, food: FoodItem) => void>(
        "MealPlanner",
        "startReplacingFood",
      )(2, eggs);
    });
    const tofu: Food = {
      id: "tofu",
      name: "Tofu",
      protein: 15,
      carbs: 2,
      fat: 8,
      calories: 140,
    };
    await act(async () => {
      prop<(food: Food) => void>("MealPlanner", "replaceFood")(tofu);
    });
    expect(writtenLunch()).toEqual([
      expect.objectContaining({ name: "Tofu", loggedAt: EATEN_AT }),
    ]);
  });
});
