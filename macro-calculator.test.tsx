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
import {
  DEFAULT_WORKOUT_MEALS,
  workoutMealsForDay,
} from "@maqro/core/workout-meals";
import type { User } from "@supabase/supabase-js";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { LaterChoice } from "./components/macro/EatenNowToggle";

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
  /** What each deferred edit (`commitToDay`) would write: its update run
   *  against the day's stored meals (`null` = rejected as stale). */
  commits: [] as (Meal[] | null)[],
}));

// The real toast, its calls recorded: an Undo is its action.
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(vi.fn(), actual.toast) };
});
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
      // Runs against the day's stored meals when it lands, as the real
      // hook does: a deferred edit (an Undo) sees what was written since.
      commitToDay: async (
        _target: unknown,
        update: (latest: Meal[]) => Meal[] | null,
      ) => {
        writes.commits.push(
          update(dayMeals.byDate[date] ?? dayMeals.override ?? MEALS),
        );
        return true;
      },
    };
  },
}));
vi.mock("./hooks/use-food-search", () => ({
  useFoodSearch: () => ({ results: [], isSearchingRemote: false }),
}));
vi.mock("./hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./lib/ai-plan", async (importOriginal) => ({
  // The real request builders (pure); only the network call is stubbed.
  ...(await importOriginal<typeof import("./lib/ai-plan")>()),
  requestAiMealPlan,
}));
vi.mock("./lib/db", async (importOriginal) => ({
  // The real `todayKey` (local day off the faked clock) and pure helpers;
  // every IndexedDB read the component makes is served empty.
  ...(await importOriginal<typeof import("./lib/db")>()),
  listCustomFoods: async () => [],
  listDailyLogs: async () => [],
  // The usual meal times' history (`useUsualMealMinutes`): none.
  listDailyLogsBetween: async () => [],
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
  writes.commits = [];
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

  it("'I had another of these' is a new portion eaten now on today, untimed on another day", async () => {
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
    const lunchWithEggs = MEALS.map((m) =>
      m.id === 2 ? { ...m, foods: [eggs] } : m,
    );
    const duplicate = () =>
      act(async () => {
        prop<(mealId: number, foodId: number) => void>(
          "MealPlanner",
          "duplicateFood",
        )(2, 11);
      });

    dayMeals.override = lunchWithEggs;
    render(<MacroCalculator />);
    await duplicate();
    const [original, copy] = writtenLunch();
    // The first portion keeps its time; the second was eaten just now.
    expect(original).toEqual(eggs);
    expect(copy).toEqual(
      expect.objectContaining({ name: "Eggs", loggedAt: NOW }),
    );
    expect(copy?.id).not.toBe(eggs.id);

    // Another day has no true hour for a portion added to it now.
    cleanup();
    writes.setMeals.mockReset();
    dayMeals.byDate[PAST_DAY] = lunchWithEggs;
    await renderOnPastDay();
    await duplicate();
    const past = writtenLunch();
    expect(past).toHaveLength(2);
    expect(past[1]?.loggedAt).toBeUndefined();
  });
});

describe("macro-calculator: eaten now or later", () => {
  /** The faked clock (12:00 on TODAY). */
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
  const RICE: Food = {
    id: "rice",
    name: "Rice",
    protein: 3,
    carbs: 28,
    fat: 0,
    calories: 130,
  };
  /** Lunch planned: rice with no time yet. */
  const PLANNED_RICE: FoodItem = {
    id: 21,
    name: "Rice",
    protein: 3,
    carbs: 28,
    fat: 0,
    calories: 130,
    portionSize: 100,
  };
  const lunchPlanned = () =>
    MEALS.map((m) => (m.id === 2 ? { ...m, foods: [PLANNED_RICE] } : m));

  const later = () =>
    prop<LaterChoice | undefined>("LogMealSheet", "laterChoice");
  const lunch = (meals: Meal[] | null | undefined) =>
    meals?.find((m) => m.id === 2)?.foods ?? [];
  const quickAdd = () =>
    act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "AppShell",
        "onQuickAdd",
      )(document.createElement("button"));
    });

  it("'Later' in the launcher plans what its tool adds; the flow's end goes back to eaten now", async () => {
    render(<MacroCalculator />);
    await quickAdd();
    expect(later()?.later).toBe(false);
    await act(async () => later()?.onLaterChange(true));
    expect(later()?.later).toBe(true);
    // The recipe picker it opens follows the choice.
    await act(async () => {
      prop<(m: string, id: number) => void>("LogMealSheet", "onMethod")(
        "recipe",
        2,
      );
    });
    await act(async () => {
      prop<(r: Recipe) => void>("ApplyRecipeDialog", "onApply")(RECIPE);
    });
    const added = lunch(writes.setMeals.mock.lastCall?.[0]);
    expect(added.length).toBeGreaterThan(0);
    for (const food of added) expect(food.loggedAt).toBeUndefined();
    // Closing the picker ends the flow: the next one starts at eaten now.
    await act(async () => {
      prop<(open: boolean) => void>("ApplyRecipeDialog", "onOpenChange")(false);
    });
    expect(later()?.later).toBe(false);
  });

  it("a recent's one-tap log says it was planned", async () => {
    render(<MacroCalculator />);
    await quickAdd();
    await act(async () => later()?.onLaterChange(true));
    const success = vi.spyOn(toast, "success");
    await act(async () => {
      prop<(f: Food, id: number, g: number) => void>(
        "LogMealSheet",
        "onQuickLog",
      )(RICE, 2, 100);
    });
    expect(success).toHaveBeenCalledWith(
      "Planned Rice (100 g, 130 kcal) for Lunch",
    );
    expect(
      lunch(writes.setMeals.mock.lastCall?.[0])[0]?.loggedAt,
    ).toBeUndefined();
  });

  it("offers the choice on today only", async () => {
    render(<MacroCalculator />);
    expect(prop("MealHubSheet", "laterChoice")).toBeDefined();
    expect(prop("FoodSearchSheet", "laterChoice")).toBeDefined();
    cleanup();
    await renderOnPastDay();
    expect(later()).toBeUndefined();
    expect(prop("MealHubSheet", "laterChoice")).toBeUndefined();
    expect(prop("FoodSearchSheet", "laterChoice")).toBeUndefined();
  });

  it("'Ate it' times today's planned food, with an Undo", async () => {
    dayMeals.override = lunchPlanned();
    render(<MacroCalculator />);
    await act(async () => {
      prop<(id: number, foods: number[], minute: number | null) => void>(
        "MealPlanner",
        "onAteIt",
      )(2, [21], 11 * 60 + 30);
    });
    const eatenAt = new Date(2026, 5, 10, 11, 30).getTime();
    expect(lunch(writes.setMeals.mock.lastCall?.[0])).toEqual([
      { ...PLANNED_RICE, loggedAt: eatenAt },
    ]);
    const [message, options] = vi.mocked(toast).mock.lastCall ?? [];
    expect(message).toBe("Rice eaten at 11:30");
    const action = options?.action;
    if (!action || typeof action !== "object" || !("onClick" in action)) {
      throw new Error("the toast has no Undo");
    }
    // Undo, once the eaten rice is stored, puts it back to planned: its
    // button, as the toast renders it.
    dayMeals.override = writes.setMeals.mock.lastCall?.[0] ?? null;
    const undo = render(
      <button
        type="button"
        onClick={action.onClick}
      >
        {action.label}
      </button>,
    );
    await act(async () => {
      fireEvent.click(undo.getByRole("button", { name: "Undo" }));
    });
    expect(lunch(writes.commits.at(-1))).toEqual([PLANNED_RICE]);

    // Now, and never later than now.
    await act(async () => {
      prop<(id: number, foods: number[], minute: number | null) => void>(
        "MealPlanner",
        "onAteIt",
      )(2, [21], 13 * 60);
    });
    expect(lunch(writes.setMeals.mock.lastCall?.[0])[0]?.loggedAt).toBe(NOW);
  });

  it("'Ate it' is today's; a time can be planned today and ahead", async () => {
    render(<MacroCalculator />);
    expect(prop("MealPlanner", "onAteIt")).toBeTypeOf("function");
    expect(prop("MealPlanner", "onPlanFor")).toBeTypeOf("function");
    cleanup();
    await renderOnPastDay();
    expect(prop("MealPlanner", "onAteIt")).toBeUndefined();
    expect(prop("MealPlanner", "onPlanFor")).toBeUndefined();
  });

  it("plans a meal for a time, and back at its usual time", async () => {
    dayMeals.override = lunchPlanned();
    render(<MacroCalculator />);
    const planFor = (time: string | undefined) =>
      act(async () => {
        prop<(id: number, time: string | undefined) => void>(
          "MealPlanner",
          "onPlanFor",
        )(2, time);
      });
    await planFor("13:15");
    const written = () =>
      writes.setMeals.mock.lastCall?.[0].find((m) => m.id === 2);
    expect(written()?.plannedTime).toBe("13:15");
    await planFor(undefined);
    expect(written()).toBeDefined();
    expect(written()).not.toHaveProperty("plannedTime");
  });

  it("a duplicate of planned food is planned too", async () => {
    dayMeals.override = lunchPlanned();
    render(<MacroCalculator />);
    await act(async () => {
      prop<(mealId: number, foodId: number) => void>(
        "MealPlanner",
        "duplicateFood",
      )(2, 21);
    });
    const [original, copy] = lunch(writes.setMeals.mock.lastCall?.[0]);
    expect(original).toEqual(PLANNED_RICE);
    expect(copy?.name).toBe("Rice");
    expect(copy?.loggedAt).toBeUndefined();
  });
});

/** Training days' workout meals: the day view works on the meals as shown
 *  (stored + the planned, still-empty workout meals, in time order) and
 *  writes back only what holds food. */
describe("macro-calculator: workout meals", () => {
  /** TODAY (a Wednesday) trains upper body at 18:00 for an hour. */
  const TRAINING: PersonalInfo = {
    ...PROFILE,
    training: {
      enabled: true,
      cycling: "modest",
      days: [
        { type: "rest" },
        { type: "rest" },
        { type: "rest" },
        {
          type: "upper",
          intensity: "moderate",
          time: "18:00",
          durationMin: 60,
        },
        { type: "rest" },
        { type: "rest" },
        { type: "rest" },
      ],
    },
  };
  const day = targetsForDate(TRAINING, TODAY, pro);
  const plan = workoutMealsForDay(day, DEFAULT_WORKOUT_MEALS);
  const SHAKE: FoodItem = {
    id: 77,
    name: "Protein shake",
    protein: 25,
    carbs: 5,
    fat: 2,
    calories: 138,
    portionSize: 300,
  };
  const names = (meals: Meal[]) => meals.map((m) => m.name);

  /** Render on TODAY with the training profile; the overrides load. */
  async function renderTraining() {
    stored.profile = TRAINING;
    render(<MacroCalculator />);
    await act(async () => {});
  }

  it("shows the planned workout meals among the others, by time", async () => {
    await renderTraining();
    expect(plan?.pre?.aimMinute).toBe(16 * 60 + 30);
    expect(names(prop<Meal[]>("MealPlanner", "meals"))).toEqual([
      "Breakfast",
      "Lunch",
      "Pre-workout",
      "Post-workout",
      "Dinner",
      "Snacks",
    ]);
    expect(prop("MealPlanner", "workoutMeals")).toEqual(plan);
  });

  it("plans no workout meal before the overrides have loaded", async () => {
    stored.profile = TRAINING;
    overridesRead.pending = new Promise(() => {});
    render(<MacroCalculator />);
    await act(async () => {});
    expect(names(prop<Meal[]>("MealPlanner", "meals"))).toEqual(names(MEALS));
    expect(prop("MealPlanner", "workoutMeals")).toBeNull();
  });

  it("a first food stores the workout meal; the empty one is never written", async () => {
    await renderTraining();
    await act(async () => {
      prop<(food: Food, mealId: number, grams: number) => void>(
        "MealPlanner",
        "onQuickLog",
      )(
        {
          name: "Banana",
          protein: 1,
          carbs: 23,
          fat: 0,
          calories: 89,
          category: "fruit",
        },
        5,
        120,
      );
    });
    const written = writes.setMeals.mock.lastCall?.[0] ?? [];
    expect(written.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    expect(written[4]).toMatchObject({
      id: 5,
      name: "Pre-workout",
      role: "preWorkout",
    });
    expect(written[4]?.foods.map((f) => f.name)).toEqual(["Banana"]);
  });

  it("emptying a workout meal drops it from storage", async () => {
    dayMeals.override = [
      ...MEALS,
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    await renderTraining();
    await act(async () => {
      prop<(mealId: number, foodId: number) => void>(
        "MealPlanner",
        "removeFood",
      )(6, SHAKE.id);
    });
    expect(writes.setMeals.mock.lastCall?.[0]).toEqual(MEALS);
  });

  it("Auto-fill plans every meal the day plans, workout meals by their aims", async () => {
    await renderTraining();
    const BANANA: FoodItem = { ...SHAKE, id: 88, name: "Banana", protein: 1 };
    // The route numbers its meals by position: never the app's ids.
    requestAiMealPlan.mockResolvedValue({
      kind: "ok",
      meals: names(prop<Meal[]>("MealPlanner", "meals")).map((name, i) => ({
        id: i + 1,
        name,
        foods: name === "Pre-workout" ? [BANANA] : [],
      })),
    });
    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
    });
    const req = requestAiMealPlan.mock.lastCall?.[0];
    expect(req?.mealNames).toEqual([
      "Breakfast",
      "Lunch",
      "Pre-workout",
      "Post-workout",
      "Dinner",
      "Snacks",
    ]);
    // The whole day; the workout meals carry their own aims and windows.
    expect(req?.targets).toEqual({
      protein: day.protein,
      carbs: day.carbs,
      fat: day.fat,
      calories: day.targetCalories,
    });
    expect(req?.workoutMeals).toEqual([
      {
        name: "Pre-workout",
        role: "preWorkout",
        aims: plan?.pre?.aims,
        window: "15:00–17:00",
      },
      {
        name: "Post-workout",
        role: "postWorkout",
        aims: plan?.post?.aims,
        window: "19:00–21:00",
      },
    ]);
    expect(req?.session).toBe("Upper · Moderate · 18:00 · 60\u00a0min");
    // The plan lands on the app's own meals: the pre-workout food in the
    // pre-workout meal (id 5, its role kept), the empty post-workout meal
    // not stored.
    const written = writes.commits.at(-1) ?? [];
    expect(written.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    expect(written[4]).toMatchObject({ role: "preWorkout" });
    expect(written[4]?.foods.map((f) => f.name)).toEqual(["Banana"]);
  });

  it("a workout meal kept for its food on a rest day keeps it; the day plans around it", async () => {
    // A rest day (Monday): no plan, a post-workout meal kept with food.
    vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0));
    dayMeals.override = [
      ...MEALS,
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    await renderTraining();
    await act(async () => {
      await prop<() => Promise<void>>("MealPlanner", "generateMealPlan")();
    });
    const rest = targetsForDate(TRAINING, "2026-06-08", pro);
    const req = requestAiMealPlan.mock.lastCall?.[0];
    expect(req?.mealNames).toEqual(names(MEALS));
    expect(req?.workoutMeals).toBeUndefined();
    expect(req?.targets).toEqual({
      protein: rest.protein - SHAKE.protein,
      carbs: rest.carbs - SHAKE.carbs,
      fat: rest.fat - SHAKE.fat,
      calories: rest.targetCalories - SHAKE.calories,
    });
    expect(writes.commits.at(-1)?.at(-1)).toEqual(dayMeals.override[4]);
  });

  it("regenerate fills a workout meal against its aims and keeps its role", async () => {
    await renderTraining();
    const BANANA: FoodItem = { ...SHAKE, id: 88, name: "Banana", protein: 1 };
    requestAiMealPlan.mockResolvedValue({
      kind: "ok",
      meals: [{ id: 1, name: "Pre-workout", foods: [BANANA] }],
    });
    await act(async () => {
      await prop<(mealId: number) => Promise<void>>(
        "MealPlanner",
        "onRegenerateMeal",
      )(5);
    });
    const req = requestAiMealPlan.mock.lastCall?.[0];
    expect(req?.targetMealName).toBe("Pre-workout");
    expect(req?.workoutMeals?.map((w) => w.name)).toEqual([
      "Pre-workout",
      "Post-workout",
    ]);
    const written = writes.commits.at(-1) ?? [];
    expect(written.find((m) => m.id === 5)).toMatchObject({
      name: "Pre-workout",
      role: "preWorkout",
      foods: [BANANA],
    });
  });

  it("regenerate never runs on a workout meal kept for its food on a rest day", async () => {
    vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0));
    dayMeals.override = [
      ...MEALS,
      { id: 6, name: "Post-workout", role: "postWorkout", foods: [SHAKE] },
    ];
    await renderTraining();
    await act(async () => {
      await prop<(mealId: number) => Promise<void>>(
        "MealPlanner",
        "onRegenerateMeal",
      )(6);
    });
    expect(requestAiMealPlan).not.toHaveBeenCalled();
  });

  it("quick add inside a workout meal's window starts on that meal", async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 16, 0, 0));
    await renderTraining();
    await act(async () => {
      prop<(trigger: HTMLElement) => void>(
        "AppShell",
        "onQuickAdd",
      )(document.createElement("button"));
    });
    expect(prop("LogMealSheet", "initialMealId")).toBe(5);
  });

  it("a workout meal ranks recipes against its own aims", async () => {
    await renderTraining();
    await act(async () => {
      prop<(mealId: number) => void>("MealPlanner", "onApplyRecipe")(5);
    });
    const aims = plan?.pre?.aims;
    expect(prop("ApplyRecipeDialog", "slotBudget")).toEqual({
      protein: aims?.protein,
      carbs: aims?.carbs,
      fat: aims?.fat,
    });
    // A regular meal: an even share of what the workout meals leave.
    await act(async () => {
      prop<(mealId: number) => void>("MealPlanner", "onApplyRecipe")(2);
    });
    const both = [plan?.pre?.aims, plan?.post?.aims];
    const left = (k: "protein" | "carbs" | "fat") =>
      day[k] - both.reduce((sum, a) => sum + (a?.[k] ?? 0), 0);
    expect(prop("ApplyRecipeDialog", "slotBudget")).toEqual(
      computeSlotBudget(
        { protein: left("protein"), carbs: left("carbs"), fat: left("fat") },
        4,
      ),
    );
  });

  it("recipe schedules and the day suggester see the regular meals", async () => {
    await renderTraining();
    await act(async () => {
      prop<() => void>("MealPlanner", "onOpenSuggestDay")();
    });
    expect(names(prop<Meal[]>("SuggestDayDialog", "meals"))).toEqual(
      names(MEALS),
    );
    await act(async () => {
      prop<(k: string) => void>("AppShell", "onSelect")("recipes");
    });
    expect(names(prop<Meal[]>("RecipesView", "currentMeals"))).toEqual(
      names(MEALS),
    );
  });
});
