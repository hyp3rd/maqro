/**
 * @vitest-environment jsdom
 */
import type { Meal, PersonalInfo } from "@/components/macro/types";
import { useTargets } from "@/hooks/use-targets";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import type * as React from "react";
import { useRef, useState } from "react";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderDayMeals } from "@maqro/core/meal-order";
import { targetsForDate, weekTargets } from "@maqro/core/targets";
import {
  DEFAULT_WORKOUT_MEALS,
  dayMealsWithWorkout,
  workoutMealsForDay,
} from "@maqro/core/workout-meals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { act } from "@testing-library/react";
import { DayTypeSheet } from "./DayTypeSheet";
import MealPlanner from "./MealPlanner";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
// Heavy siblings with their own IDB / form state: stubs keep this test on
// the day view's composition.
vi.mock("./AddFoodForm", () => ({ default: () => <div>AddFoodForm</div> }));
vi.mock("./WaterCounter", () => ({ WaterCounter: () => <div>Water</div> }));
vi.mock("./FastingCard", () => ({ FastingCard: () => <div>Fasting</div> }));
// A pinned minute clock: Wed 21 Oct 2026, 15:10 local.
const { NOW } = vi.hoisted(() => ({
  NOW: new Date(2026, 9, 21, 15, 10).getTime(),
}));
vi.mock("@/hooks/use-now", () => ({ useNow: () => NOW }));
// useTargets' tier (the provider-backed hook): free, so no goal phases.
vi.mock("@/hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: "free", resolved: true }),
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // jsdom has no matchMedia; the gesture primitives ask for a coarse pointer.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TODAY = "2026-10-21";
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
  training: {
    enabled: true,
    cycling: "modest",
    days: [
      { type: "rest" },
      { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
      { type: "rest" },
      { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
      { type: "rest" },
      { type: "fullBody", intensity: "moderate" },
      { type: "endurance", durationMin: 90 },
    ],
  },
};

const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).getTime();
const food = (id: number, calories: number, loggedAt?: number) => ({
  id,
  name: `Food ${id}`,
  protein: 20,
  carbs: 40,
  fat: 10,
  calories,
  portionSize: 100,
  ...(loggedAt === undefined ? {} : { loggedAt }),
});
const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(1, 520, at(7, 30))] },
  { id: 2, name: "Lunch", foods: [food(2, 720, at(12, 45))] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

function plannerProps(
  overrides: Partial<React.ComponentProps<typeof MealPlanner>> = {},
): React.ComponentProps<typeof MealPlanner> {
  const selectedDate = overrides.selectedDate ?? TODAY;
  const ctx = { phasesEnabled: false };
  const props: React.ComponentProps<typeof MealPlanner> = {
    calculatedValues: targetsForDate(PROFILE, selectedDate, ctx),
    week: weekTargets(PROFILE, selectedDate, ctx),
    totalMacros: { protein: 40, carbs: 80, fat: 20, calories: 1240 },
    macroBreakdown: {},
    meals: MEALS,
    dayHydrated: true,
    selectedDate,
    today: TODAY,
    waterGoalMl: 2400,
    units: "metric",
    goalPhase: null,
    goalPhaseNudge: null,
    onSelectDate: vi.fn(),
    newFood: {
      id: 0,
      name: "",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
      portionSize: 0,
    },
    foodSearch: "",
    foodSuggestions: [],
    pantryItems: [],
    showSuggestions: false,
    isSearchingRemote: false,
    portionSize: 100,
    isGeneratingMealPlan: false,
    generatingMealId: null,
    mealPlanMessage: "",
    coherenceIssues: [],
    editingFood: {
      mealId: null,
      foodId: null,
      portionSize: 0,
      originalFood: null,
    },
    replacingFood: {
      mealId: null,
      foodId: null,
      portionSize: 0,
      searchTerm: "",
      suggestions: [],
      showSuggestions: false,
    },
    suggestionsRef: { current: null },
    replacementSuggestionsRef: { current: null },
    setNewFood: vi.fn(),
    setFoodSearch: vi.fn(),
    handleFoodSearch: vi.fn(),
    handleFoodSelect: vi.fn(),
    handlePortionChange: vi.fn(),
    handleFoodChange: vi.fn(),
    addFood: vi.fn(() => true),
    onQuickLog: vi.fn(),
    removeFood: vi.fn(),
    duplicateFood: vi.fn(),
    moveFood: vi.fn(),
    startEditingFood: vi.fn(),
    cancelEditing: vi.fn(),
    handleEditPortionChange: vi.fn(),
    saveEditedPortion: vi.fn(),
    startReplacingFood: vi.fn(),
    cancelReplacing: vi.fn(),
    handleReplacementSearch: vi.fn(),
    replaceFood: vi.fn(),
    generateMealPlan: vi.fn(async () => {}),
    onRefineMealPlan: vi.fn(async () => {}),
    onRegenerateMeal: vi.fn(async () => {}),
    setPortionSize: vi.fn(),
    onSaveOffToCustom: vi.fn(),
    onOpenCustomFoodForm: vi.fn(),
    onOpenCamera: vi.fn(),
    onSaveAsTemplate: vi.fn(),
    onAddFromTemplate: vi.fn(),
    onApplyRecipe: vi.fn(),
    onClearMeal: vi.fn(),
    loggedMealSignal: null,
    mealSchedules: [],
    onLogScheduled: vi.fn(),
    onOpenSuggestDay: vi.fn(),
    onOpenMealDetail: vi.fn(),
    ...overrides,
  };
  return props;
}

function renderPlanner(
  overrides: Partial<React.ComponentProps<typeof MealPlanner>> = {},
) {
  const props = plannerProps(overrides);
  render(<MealPlanner {...props} />, { wrapper: intlWrapper() });
  return props;
}

/** The gauge's centre (dnd-kit adds its own live region to the page). */
const gaugeStatus = () => {
  const centre = screen
    .getAllByRole("status")
    .find((s) => /kcal|target/.test(s.textContent ?? ""));
  if (!centre) throw new Error("no gauge centre");
  return centre;
};

describe("MealPlanner as Instrument Today", () => {
  it("keeps Share in the header's title row, ahead of the gauge", () => {
    renderPlanner();
    const header = screen
      .getByRole("heading", { level: 1 })
      .closest("header") as HTMLElement;
    const share = within(header).getByRole("button", {
      name: "Share today's macros",
    });
    expect(
      share.compareDocumentPosition(gaugeStatus()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers Share only on today: another day is not 'today's macros'", () => {
    // Past (food logged) and future (food planned ahead).
    for (const selectedDate of ["2026-10-19", "2026-10-23"]) {
      renderPlanner({ selectedDate });
      expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
      cleanup();
    }
  });

  it("is one region, named by the day, with no region nested inside", () => {
    renderPlanner();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).queryAllByRole("region")).toHaveLength(0);
  });

  it("leads with the day's header and its planned session", () => {
    renderPlanner();
    expect(
      screen.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeTruthy();
    // Wednesday in the template: a hard lower-body session.
    expect(screen.getByText("Lower · heavy day · 18:00")).toBeTruthy();
  });

  it("explains a training day's targets in a calm line under the gauge", () => {
    renderPlanner();
    expect(
      screen.getByText("Carbs are higher today — heavy session at 18:00"),
    ).toBeTruthy();
  });

  it("says nothing more on a rest day or with training off", () => {
    renderPlanner({ selectedDate: "2026-10-20" });
    expect(screen.queryByText(/are (higher|lower)/)).toBeNull();
    cleanup();
    const off = { ...PROFILE, training: undefined };
    renderPlanner({
      calculatedValues: targetsForDate(off, TODAY, { phasesEnabled: false }),
      week: weekTargets(off, TODAY, { phasesEnabled: false }),
    });
    expect(screen.queryByText(/are (higher|lower)/)).toBeNull();
  });

  it("hides the session chip while training is off", () => {
    const off = { ...PROFILE, training: undefined };
    renderPlanner({
      calculatedValues: targetsForDate(off, TODAY, { phasesEnabled: false }),
      week: weekTargets(off, TODAY, { phasesEnabled: false }),
    });
    expect(screen.queryByText(/heavy day|Rest day/)).toBeNull();
  });

  it("shows the gauge against the selected day's own target", () => {
    const props = renderPlanner();
    const target = Math.round(props.calculatedValues.targetCalories);
    expect(gaugeStatus().textContent).toBe(
      `${(target - 1240).toLocaleString("en")} kcal left today`,
    );
  });

  it("draws the timing track with the meals, the workout and now", () => {
    renderPlanner();
    expect(
      screen.getByRole("img", {
        name: /^Day timeline: Breakfast at 07:30, 520 kcal\. Lunch at 12:45, 720 kcal\. Workout, Lower · heavy day, 18:00 to 19:15\. Now 15:10\.$/,
      }),
    ).toBeTruthy();
  });

  it("strips the week with each day's own target and selects a tapped day", () => {
    const props = renderPlanner();
    const week = screen.getByRole("group", { name: "Week" });
    const days = within(week).getAllByRole("button");
    expect(days).toHaveLength(7);
    // Tuesday is a rest day in the cycled week: its own (lower) target.
    const tue = props.week?.days[1]?.targetCalories ?? 0;
    const wed = props.week?.days[2]?.targetCalories ?? 0;
    expect(tue).toBeLessThan(wed);
    expect(days[1]?.getAttribute("aria-label")).toBe(
      `Tue 20 Oct, target ${tue.toLocaleString("en")} kcal`,
    );
    expect(days[2]?.getAttribute("aria-current")).toBe("date");
    fireEvent.click(days[4] as HTMLElement);
    expect(props.onSelectDate).toHaveBeenCalledWith("2026-10-23");
  });

  it("puts the loaded day's live total on its strip bar", async () => {
    const props = renderPlanner();
    const wed = props.week?.days[2]?.targetCalories ?? 0;
    const week = screen.getByRole("group", { name: "Week" });
    // Settle the (empty) IndexedDB week read: the live total still shows.
    await waitFor(() =>
      expect(
        within(week).getByRole("button", {
          name: `Wed 21 Oct, today, 1,240 of ${wed.toLocaleString("en")} kcal so far`,
        }),
      ).toBeTruthy(),
    );
  });

  it("keeps a day that has not loaded yet off the live total", async () => {
    // Mid date change: `totalMacros` is still the previous day's.
    const props = renderPlanner({ dayHydrated: false });
    const wed = props.week?.days[2]?.targetCalories ?? 0;
    const week = screen.getByRole("group", { name: "Week" });
    await waitFor(() =>
      expect(
        within(week).getByRole("button", {
          name: `Wed 21 Oct, today, target ${wed.toLocaleString("en")} kcal`,
        }),
      ).toBeTruthy(),
    );
    expect(within(week).queryByRole("button", { name: /1,240/ })).toBeNull();
  });

  it("puts the meals on a rail with the next slot highlighted", () => {
    renderPlanner();
    const rail = screen.getByRole("list", { name: "Meals" });
    expect(
      within(rail)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Breakfast", "Lunch", "Dinner", "Snacks"]);
    expect(within(rail).getByText("Next to log")).toBeTruthy();
  });

  it("shows each meal's P/C/F split however narrow its list is", () => {
    render(<MealPlanner {...plannerProps()} />, { wrapper: intlWrapper() });
    const rail = screen.getByRole("list", { name: "Meals" });
    // The meal list is the size container; the split follows its width,
    // not the viewport's.
    expect(rail.className).toContain("@container");
    // The rail's own items (each meal card lists its foods too).
    const [breakfast, , dinner] = [...rail.children] as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    // Narrow: on its own line under the meal's header.
    const narrow = breakfast.querySelector("[data-part=meal-split-narrow]");
    expect(narrow?.textContent).toBe("P20 · C40 · F10");
    expect(narrow?.className).toContain("@min-[30rem]:hidden");
    // Wide: beside the kcal in the header.
    const wide = breakfast.querySelector("[data-part=meal-split]");
    expect(wide?.textContent?.trim()).toBe("· P20 · C40 · F10");
    expect(wide?.className).toContain("@min-[30rem]:inline");
    expect(wide?.className).not.toContain("sm:inline");
    // An empty meal has no split to show.
    expect(dinner.querySelector("[data-part=meal-split-narrow]")).toBeNull();
  });

  it("keeps one-tap water and fasting ahead of the meal list", () => {
    renderPlanner();
    const meals = screen.getByRole("list", { name: "Meals" });
    for (const extra of [
      screen.getByText("Water"),
      screen.getByText("Fasting"),
    ]) {
      expect(
        extra.compareDocumentPosition(meals) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("words a future day 'to plan' and draws no now cursor there", () => {
    renderPlanner({
      selectedDate: "2026-10-23",
      totalMacros: { protein: 0, carbs: 0, fat: 0, calories: 300 },
      meals: MEALS.map((m) => ({ ...m, foods: [] })),
    });
    expect(gaugeStatus().textContent).toMatch(/kcal to plan$/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Friday",
    );
    expect(
      screen
        .getByRole("img", { name: /^Day timeline:/ })
        .getAttribute("aria-label"),
    ).not.toMatch(/Now/);
  });

  it("renders before hydration, when the date keys are still empty", () => {
    renderPlanner({
      selectedDate: "",
      today: "",
      calculatedValues: targetsForDate(PROFILE, "", { phasesEnabled: false }),
      week: null,
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
    expect(screen.queryByRole("group", { name: "Week" })).toBeNull();
  });

  it("offers one way back to today from another day, landing on the heading", () => {
    const props = renderPlanner({ selectedDate: "2026-10-20" });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Yesterday");
    // Exactly one control returns to today (the old date navigator's
    // second "Today" button is gone).
    expect(
      screen.getAllByRole("button", { name: /^(Back to today|Today)$/ }),
    ).toHaveLength(1);
    // On the date line beside the date, so a long session chip never
    // pushes it onto a row of its own; touch-sized by the same hit-slop.
    const back = screen.getByRole("button", { name: "Back to today" });
    expect(back.closest('[data-part="date-line"]')).not.toBeNull();
    expect(back.className).toContain("coarse:before:-inset-y-[13px]");
    fireEvent.click(back);
    expect(props.onSelectDate).toHaveBeenCalledWith(TODAY);
    expect(document.activeElement).toBe(heading);
  });

  it("names the day once: one h1 and no second day navigator", () => {
    renderPlanner();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to today" })).toBeNull();
    // The meal list is a section of the page under that heading.
    expect(
      screen.getByRole("heading", { level: 2, name: "Meals" }),
    ).toBeTruthy();
  });

  describe("the date opens a picker for any day", () => {
    const trigger = () =>
      screen.getByRole("button", { name: "Wed, Oct 21, choose a day" });
    /** The date field the picker writes to (hidden behind the button). */
    const field = () => {
      const input =
        trigger().parentElement?.querySelector('input[type="date"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("no field");
      return input;
    };

    afterEach(() => {
      // jsdom has no showPicker(); a case that needs one adds it.
      Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    });

    it("is a visible button that shows keyboard focus and is touch-sized", () => {
      renderPlanner();
      const button = trigger();
      expect(button.tagName).toBe("BUTTON");
      // Focus is drawn on the date itself, since the button is taller.
      const face = button.querySelector('[data-part="date-trigger-face"]');
      expect(face?.className).toContain("group-focus-visible:ring-2");
      expect(button.className).toContain("group");
      // The line stays one 18 px row on every pointer; on a touch screen
      // the button's hit area (an absolute ::before) reaches 44 px —
      // 13 px past each side of the line — without taking layout space.
      // The measured target is asserted in e2e/today-narrow.spec.ts.
      const line = button.closest('[data-part="date-line"]');
      expect(line?.className).toContain("h-[1.125rem]");
      expect(line?.className).not.toMatch(/coarse:h-/);
      expect(button.className).toContain("relative");
      expect(button.className).toContain("coarse:before:absolute");
      expect(button.className).toContain("coarse:before:-inset-y-[13px]");
      expect(line?.contains(screen.getByRole("heading", { level: 1 }))).toBe(
        false,
      );
      // The field behind it is neither tabbable nor announced.
      expect(field().tabIndex).toBe(-1);
      expect(field().getAttribute("aria-hidden")).toBe("true");
    });

    it("opens the platform picker; a chosen day, future included, is shown", () => {
      const showPicker = vi.fn();
      Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
        value: showPicker,
        configurable: true,
      });
      const props = renderPlanner();
      fireEvent.click(trigger());
      expect(showPicker).toHaveBeenCalledOnce();
      expect(showPicker.mock.contexts[0]).toBe(field());
      // A future day can be planned, as on the week strip: no cap at today.
      expect(field().hasAttribute("max")).toBe(false);
      fireEvent.change(field(), { target: { value: "2026-11-02" } });
      expect(props.onSelectDate).toHaveBeenCalledWith("2026-11-02");
      fireEvent.change(field(), { target: { value: "2026-09-30" } });
      expect(props.onSelectDate).toHaveBeenLastCalledWith("2026-09-30");
    });

    it("shows the date field itself when the browser can't open a picker", () => {
      Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
        value: () => {
          throw new DOMException("no gesture", "NotAllowedError");
        },
        configurable: true,
      });
      const props = renderPlanner();
      fireEvent.click(trigger());
      const typed = screen.getByLabelText("Wed, Oct 21, choose a day");
      expect(typed.getAttribute("type")).toBe("date");
      expect(typed.getAttribute("aria-hidden")).toBeNull();
      expect(document.activeElement).toBe(typed);
      fireEvent.change(typed, { target: { value: "2026-10-15" } });
      // Leaving it shows the typed day and brings the button back (the
      // field's own rules are in TodayHeader.test.tsx).
      fireEvent.blur(typed);
      expect(props.onSelectDate).toHaveBeenCalledWith("2026-10-15");
      expect(trigger().tagName).toBe("BUTTON");
    });
  });
});

/** The app's wiring (macro-calculator): live `useTargets` (with this
 *  device's stored overrides) feeds the planner, and the header's session
 *  chip opens the day-type sheet for the shown day. */
function TodayWithDayType() {
  const { dayTargets, selectedWeek, previewDayTargets } = useTargets(
    PROFILE,
    TODAY,
    TODAY,
  );
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLElement | null>(null);
  return (
    <>
      <MealPlanner
        {...plannerProps()}
        calculatedValues={dayTargets}
        week={selectedWeek}
        onEditDayType={(trigger) => {
          chip.current = trigger;
          setOpen(true);
        }}
      />
      {open && (
        <DayTypeSheet
          targets={dayTargets}
          today={TODAY}
          previewDayTargets={previewDayTargets}
          onOpenChange={setOpen}
          returnFocusTo={chip}
        />
      )}
    </>
  );
}

describe("Today: changing the day's session from the chip", () => {
  const FREE = { phasesEnabled: false };
  const planned = weekTargets(PROFILE, TODAY, FREE);
  const restToday = targetsForDate(PROFILE, TODAY, {
    ...FREE,
    overrideFor: (d) => (d === TODAY ? { type: "rest" } : undefined),
  });
  const kcal = (n: number) => n.toLocaleString("en");
  const stripDays = () =>
    within(screen.getByRole("group", { name: "Week" })).getAllByRole("button");
  const chip = (name: RegExp) => screen.getByRole("button", { name });
  const plannedWed = planned?.days[2]?.targetCalories ?? 0;
  const plannedTue = planned?.days[1]?.targetCalories ?? 0;

  it("opens the sheet from the chip, applies the override everywhere, and goes back to plan", async () => {
    // Sanity: a rest day plans a smaller target than the hard lower day.
    expect(restToday.targetCalories).toBeLessThan(plannedWed);
    render(<TodayWithDayType />, { wrapper: intlWrapper() });

    // The plan: the chip, the gauge and Wednesday's strip bar agree.
    const planChip = await screen.findByRole("button", {
      name: "Lower, heavy day, 18:00, 75\u00a0min. Change today’s session",
    });
    expect(planChip.textContent).toBe("Lower · heavy day · 18:00");
    expect(gaugeStatus().textContent).toBe(
      `${kcal(plannedWed - 1240)} kcal left today`,
    );
    expect(stripDays()[2]?.getAttribute("aria-label")).toContain(
      `of ${kcal(plannedWed)} kcal`,
    );
    // One entry point: no interim "Session · Change" row.
    expect(screen.queryByText(/^Session:/)).toBeNull();
    expect(screen.queryByRole("group", { name: /session/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /session/i })).toHaveLength(1);

    // Today is a rest day.
    planChip.focus();
    fireEvent.click(planChip);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Rest" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    const restChip = await screen.findByRole("button", {
      name: "Rest day, changed from the plan. Change today’s session",
    });
    expect(restChip.textContent).toBe("Rest day · changed");
    expect(gaugeStatus().textContent).toBe(
      `${kcal(restToday.targetCalories - 1240)} kcal left today`,
    );
    expect(stripDays()[2]?.getAttribute("aria-label")).toContain(
      `of ${kcal(restToday.targetCalories)} kcal`,
    );
    // That day only: Tuesday keeps its planned target.
    expect(stripDays()[1]?.getAttribute("aria-label")).toBe(
      `Tue 20 Oct, target ${kcal(plannedTue)} kcal`,
    );
    // The chip that opened the sheet gets focus back.
    await waitFor(() => expect(document.activeElement).toBe(restChip));

    // Back to plan restores the chip, the gauge and the strip.
    fireEvent.click(restChip);
    const again = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(
        within(again).getByRole("button", { name: "Back to plan" }),
      );
    });
    await waitFor(() =>
      expect(chip(/change today’s session/i).textContent).toBe(
        "Lower · heavy day · 18:00",
      ),
    );
    expect(gaugeStatus().textContent).toBe(
      `${kcal(plannedWed - 1240)} kcal left today`,
    );
    expect(stripDays()[2]?.getAttribute("aria-label")).toContain(
      `of ${kcal(plannedWed)} kcal`,
    );
  });
});

describe("Today: a training day's workout meals", () => {
  const day = targetsForDate(PROFILE, TODAY, { phasesEnabled: false });
  const plan = workoutMealsForDay(day, DEFAULT_WORKOUT_MEALS);
  const shown = orderDayMeals(dayMealsWithWorkout(MEALS, plan), {
    date: TODAY,
    usual: {},
    plan,
  });

  it("each names its time and aims, and while empty what it's for", () => {
    renderPlanner({ meals: shown, workoutMeals: plan });
    const pre = plan?.pre?.aims;
    const preCard = screen
      .getByRole("heading", { name: "Pre-workout · 16:30" })
      .closest("div.rounded-lg") as HTMLElement;
    expect(preCard.textContent).toContain(
      `Aim ${pre?.calories} kcal · P${pre?.protein} · C${pre?.carbs} · F${pre?.fat}`,
    );
    expect(
      within(preCard).getByText(
        "Quick carbs and some protein, little fat or fibre.",
      ),
    ).toBeTruthy();
    expect(
      within(preCard).getByText("General guidance, not medical advice."),
    ).toBeTruthy();
    // A 75-minute session from 18:00: post-workout aims at 19:45.
    const postCard = screen
      .getByRole("heading", { name: "Post-workout · 19:45" })
      .closest("div.rounded-lg") as HTMLElement;
    expect(
      within(postCard).getByText("Protein first, within 2 hours of training."),
    ).toBeTruthy();
  });

  const menu = async (meal: string) => {
    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole("button", { name: `${meal} actions` }),
        { key: "Enter" },
      );
    });
    return screen.getByRole("menu");
  };

  it("a planned workout meal offers AI generate, like a regular meal", async () => {
    renderPlanner({ meals: shown, workoutMeals: plan });
    expect(
      within(await menu("Pre-workout")).getByRole("menuitem", {
        name: "Generate (AI)",
      }),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(
      within(await menu("Dinner")).getByRole("menuitem", {
        name: "Generate (AI)",
      }),
    ).toBeTruthy();
  });

  it("a workout meal kept for its food on a rest day has no AI generate", async () => {
    const kept: Meal = {
      id: 6,
      name: "Post-workout",
      role: "postWorkout",
      foods: [food(9, 210)],
    };
    renderPlanner({ meals: [...MEALS, kept], workoutMeals: null });
    expect(
      within(await menu("Post-workout")).queryByRole("menuitem", {
        name: /generate/i,
      }),
    ).toBeNull();
  });

  it("brackets their eating windows on the timeline", () => {
    renderPlanner({ meals: shown, workoutMeals: plan });
    expect(
      screen.getByRole("img", { name: /Pre-workout window, 15:00 to 17:00/ }),
    ).toBeTruthy();
  });
});

describe("MealPlanner: planned meals", () => {
  // Lunch half eaten (Food 2 logged, Food 3 planned); Dinner all planned,
  // usually at 20:00.
  const PLANNED: Meal[] = [
    { id: 1, name: "Breakfast", foods: [food(1, 520, at(7, 30))] },
    { id: 2, name: "Lunch", foods: [food(2, 720, at(12, 45)), food(3, 180)] },
    { id: 3, name: "Dinner", foods: [food(4, 650)] },
    { id: 4, name: "Snacks", foods: [] },
  ];
  const USUAL = { 3: 20 * 60 };
  const card = (meal: string) =>
    screen
      .getByRole("heading", { name: meal })
      .closest("div.rounded-lg") as HTMLElement;
  const menu = async (meal: string) => {
    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole("button", { name: `${meal} actions` }),
        { key: "Enter" },
      );
    });
    return screen.getByRole("menu");
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("on today, 'Ate it' marks a meal's planned food eaten now", () => {
    const onAteIt = vi.fn();
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL, onAteIt });
    expect(
      within(card("Breakfast")).queryByRole("button", { name: /^Ate it/ }),
    ).toBeNull();
    fireEvent.click(
      within(card("Dinner")).getByRole("button", { name: "Ate it: Dinner" }),
    );
    expect(onAteIt).toHaveBeenLastCalledWith(3, [4], null);
    // A half-eaten meal marks the rest.
    fireEvent.click(
      within(card("Lunch")).getByRole("button", { name: "Ate it: Lunch" }),
    );
    expect(onAteIt).toHaveBeenLastCalledWith(2, [3], null);
  });

  it("'Ate it earlier…' takes a time today, never later than now", () => {
    const onAteIt = vi.fn();
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL, onAteIt });
    fireEvent.click(
      within(card("Dinner")).getByRole("button", {
        name: "Ate it earlier…: Dinner",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "When did you eat Dinner?",
    });
    const field = within(dialog).getByLabelText("Time") as HTMLInputElement;
    // Dinner's usual 20:00 is still ahead: the field starts at now.
    expect(field.value).toBe("15:10");
    fireEvent.change(field, { target: { value: "16:00" } });
    expect(within(dialog).getByText(/later than now/).textContent).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Ate it" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "13:05" } });
    fireEvent.click(confirm);
    expect(onAteIt).toHaveBeenCalledWith(3, [4], 13 * 60 + 5);
  });

  it("marks one planned food eaten from its row", () => {
    const onAteIt = vi.fn();
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL, onAteIt });
    const lunch = card("Lunch");
    // The wide table's check, beside the row saying "planned".
    fireEvent.click(within(lunch).getByRole("button", { name: "Ate Food 3" }));
    expect(onAteIt).toHaveBeenCalledWith(2, [3], null);
    expect(
      within(lunch).queryByRole("button", { name: "Ate Food 2" }),
    ).toBeNull();
    // Partly eaten: its planned row says so; an all-planned meal's don't.
    expect(within(lunch).getAllByText("planned").length).toBeGreaterThan(0);
    expect(within(card("Dinner")).queryByText("planned")).toBeNull();
    // The narrow card's action sheet leads with it.
    onAteIt.mockClear();
    fireEvent.click(
      within(lunch).getByRole("button", { name: "Food 3 — open actions" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Food 3" })).getByRole(
        "button",
        { name: "Ate it" },
      ),
    );
    expect(onAteIt).toHaveBeenCalledWith(2, [3], null);
    // An eaten food's sheet has no "Ate it".
    fireEvent.click(
      within(lunch).getByRole("button", { name: "Food 2 — open actions" }),
    );
    expect(
      within(screen.getByRole("dialog", { name: "Food 2" })).queryByRole(
        "button",
        { name: "Ate it" },
      ),
    ).toBeNull();
  });

  it("plans an all-planned meal for a time, and back at its usual time", async () => {
    const onPlanFor = vi.fn();
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL, onPlanFor });
    // Half eaten: no time to plan.
    expect(
      within(await menu("Lunch")).queryByRole("menuitem", {
        name: "Plan for…",
      }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await act(async () => {
      fireEvent.click(
        within(await menu("Dinner")).getByRole("menuitem", {
          name: "Plan for…",
        }),
      );
    });
    const dialog = screen.getByRole("dialog", { name: "Plan Dinner for" });
    const field = within(dialog).getByLabelText("Time") as HTMLInputElement;
    expect(field.value).toBe("20:00");
    // A plan has no "Usual time" to go back to yet.
    expect(
      within(dialog).queryByRole("button", { name: "Usual time" }),
    ).toBeNull();
    fireEvent.change(field, { target: { value: "19:15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onPlanFor).toHaveBeenCalledWith(3, "19:15");
  });

  it("offers the usual time back once a meal has its own", async () => {
    const onPlanFor = vi.fn();
    const timed = PLANNED.map((m) =>
      m.id === 3 ? { ...m, plannedTime: "19:15" } : m,
    );
    renderPlanner({ meals: timed, usualMinutes: USUAL, onPlanFor });
    await act(async () => {
      fireEvent.click(
        within(await menu("Dinner")).getByRole("menuitem", {
          name: "Plan for…",
        }),
      );
    });
    const dialog = screen.getByRole("dialog", { name: "Plan Dinner for" });
    expect(
      (within(dialog).getByLabelText("Time") as HTMLInputElement).value,
    ).toBe("19:15");
    fireEvent.click(within(dialog).getByRole("button", { name: "Usual time" }));
    expect(onPlanFor).toHaveBeenCalledWith(3, undefined);
  });

  it("puts a planned meal's time on the rail, an eaten one's start as before", () => {
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL });
    const times = screen
      .getAllByText(/^\d\d:\d\d$/, { selector: "[data-part=time]" })
      .map((t) => [t.textContent, t.className.includes("text-faint")]);
    expect(times).toEqual([
      ["07:30", false],
      ["12:45", false],
      ["20:00", true],
    ]);
  });

  it("offers neither on another day without the actions", async () => {
    renderPlanner({ meals: PLANNED, usualMinutes: USUAL });
    expect(screen.queryByRole("button", { name: /^Ate it/ })).toBeNull();
    expect(
      within(await menu("Dinner")).queryByRole("menuitem", {
        name: "Plan for…",
      }),
    ).toBeNull();
  });
});
