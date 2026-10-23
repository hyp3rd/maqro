/**
 * @vitest-environment jsdom
 */
import type { AiPlanRequest, AiPlanResult } from "@/lib/ai-plan";
import { computeSlotBudget } from "@/lib/recipe-ranking";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetsForDate } from "@maqro/core/targets";
import type { Meal, PersonalInfo } from "@maqro/core/types";
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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=plan"),
}));
vi.mock("./hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: "pro", resolved: true }),
  useRefreshAiUsage: () => refreshAiUsage,
}));
vi.mock("./hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "u1" } as User,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("./hooks/use-profile", () => ({
  useProfile: () => ({
    profile: PROFILE,
    setProfile: vi.fn(),
    patchProfile: vi.fn(),
    isHydrated: true,
  }),
}));
vi.mock("./hooks/use-daily-log", () => ({
  useDailyLog: (date: string) => ({
    date,
    meals: MEALS,
    setMeals: vi.fn(),
    isHydrated: true,
    day: { date, epoch: 0 },
    commitToDay: async () => true,
  }),
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
  listMealSchedules: async () => [],
  listMicronutrientProfiles: async () => [],
  listPantryItems: async () => [],
  listRecipes: async () => [],
}));

vi.mock("./components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
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
vi.mock("./components/macro/UpgradeDialog", () => ({
  UpgradeDialog: ui.stub("UpgradeDialog"),
}));
vi.mock("./components/macro/VoiceLogSheet", () => ({
  VoiceLogSheet: ui.stub("VoiceLogSheet"),
}));

const { default: MacroCalculator } = await import("./macro-calculator");

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
