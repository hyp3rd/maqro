/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WeekTargets, weekTargets } from "@maqro/core/targets";
import {
  defaultTrainingSchedule,
  withTrainingDay,
  withTrainingEnabled,
} from "@maqro/core/training-edit";
import type {
  PersonalInfo,
  ProteinSetting,
  TrainingSchedule,
} from "@maqro/core/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { TrainingWeekEditor } from "./TrainingWeekEditor";

/** Saturday. Its week runs Mon 2026-10-19 → Sun 2026-10-25. */
const TODAY = "2026-10-24";

const BASE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "lose",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0.5,
  manualTdee: 2600,
  units: "metric",
};

const SCHEDULE: TrainingSchedule = {
  enabled: true,
  cycling: "modest",
  days: [
    { type: "rest" },
    { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
    { type: "rest" },
    { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
    { type: "rest" },
    { type: "fullBody", intensity: "moderate", time: "07:00", durationMin: 60 },
    { type: "endurance", intensity: "moderate", durationMin: 90 },
  ],
};

const CTX = { phasesEnabled: false, bodyFatPct: null };
const plan = (p: PersonalInfo) => weekTargets(p, TODAY, CTX);

/** Holds the profile like `useProfile` does, so writes re-render. */
function Harness({
  initial,
  planWeek = plan,
  onTraining,
  onProtein,
  onOpenMeasurements = () => {},
}: {
  initial: PersonalInfo;
  planWeek?: (p: PersonalInfo) => WeekTargets | null;
  onTraining?: (t: TrainingSchedule) => void;
  onProtein?: (s: ProteinSetting) => void;
  onOpenMeasurements?: () => void;
}) {
  const [profile, setProfile] = useState(initial);
  return (
    <TrainingWeekEditor
      profile={profile}
      today={TODAY}
      planWeek={planWeek}
      onTrainingChange={(training) => {
        onTraining?.(training);
        setProfile((p) => ({ ...p, training }));
      }}
      onProteinSettingChange={(proteinSetting) => {
        onProtein?.(proteinSetting);
        setProfile((p) => ({ ...p, proteinSetting }));
      }}
      onOpenMeasurements={onOpenMeasurements}
    />
  );
}

function renderEditor(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: intlWrapper() });
}

const fmt = (n: number) => n.toLocaleString("en");
/** The safety floor the editor names: max(BMR, 1200) of today's plan. */
const floorOf = (week: WeekTargets | null) =>
  fmt(Math.max(week?.days[5]?.bmr ?? 0, 1200));
const movesLine = (floor: string) =>
  `Calories move between days; your weekly average stays the same and no day goes under your safety floor (${floor} kcal).`;
const offLine = (floor: string) =>
  `Every day stays at your weekly average, above your safety floor (${floor} kcal).`;
const switchControl = () =>
  screen.getByRole("switch", { name: "Plan targets by training day" });
const row = (day: string) =>
  screen.getByRole("button", { name: new RegExp(`^Edit ${day}`) });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrainingWeekEditor: enable / disable", () => {
  it("off shows only the switch; turning it on seeds the default week", () => {
    const onTraining = vi.fn();
    renderEditor({ initial: BASE, onTraining });
    // One page heading for assistive tech; the breadcrumb shows the name.
    expect(
      screen.getByRole("heading", { level: 2, name: "Training week" }),
    ).toBeTruthy();
    expect(switchControl().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    // Off, the switch explains what turning it on does.
    const hint = /training moves calories between days, never on top/;
    const describedBy = switchControl().getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      hint,
    );

    // Never turned on: nothing to come back.
    expect(screen.queryByText(/returns as you left it/)).toBeNull();

    fireEvent.click(switchControl());
    expect(onTraining).toHaveBeenCalledWith(defaultTrainingSchedule());
    expect(switchControl().getAttribute("aria-checked")).toBe("true");
    // On, it is a compact row: the week below carries the explanation.
    expect(screen.queryByText(hint)).toBeNull();
    expect(switchControl().hasAttribute("aria-describedby")).toBe(false);
    // Seven rows, Monday first.
    const rows = screen.getAllByRole("button", { name: /^Edit / });
    expect(rows).toHaveLength(7);
    expect(rows[0]?.textContent).toContain("Edit Monday");
    expect(rows[6]?.textContent).toContain("Edit Sunday");
  });

  it("turning it off keeps the template for next time", () => {
    const onTraining = vi.fn();
    const stored = { ...BASE, training: SCHEDULE };
    renderEditor({ initial: stored, onTraining });
    fireEvent.click(switchControl());
    expect(onTraining).toHaveBeenCalledWith({ ...SCHEDULE, enabled: false });
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    // Off, the card says what turning it back on restores: the week and
    // the single days changed on their own (their overrides apply again).
    const describedBy = switchControl().getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
      "Turn it back on and your week returns as you left it, with any days you changed on their own.",
    );
    fireEvent.click(switchControl());
    expect(onTraining).toHaveBeenLastCalledWith(SCHEDULE);
  });

  it("keeps keyboard focus on the switch in both directions", () => {
    renderEditor({ initial: { ...BASE, training: SCHEDULE } });
    const control = switchControl();
    control.focus();
    // Off: the row becomes the explaining card around the same switch.
    fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.isConnected).toBe(true);
    expect(document.activeElement).toBe(control);
    // On again: the compact row, still the same, focused switch.
    fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.isConnected).toBe(true);
    expect(document.activeElement).toBe(control);
  });

  it("never clips the switch's focus ring in the compact row", () => {
    renderEditor({ initial: { ...BASE, training: SCHEDULE } });
    // On, the wrapper is only as tall as the switch, and the ring is drawn
    // outside it (ring-offset): the wrapper must not clip its overflow.
    const wrapper = () => switchControl().parentElement?.parentElement;
    expect(wrapper()?.classList.contains("overflow-visible")).toBe(true);
    expect(wrapper()?.classList.contains("overflow-hidden")).toBe(false);
    // Off, the explaining card has room around the switch and keeps its
    // rounded clip.
    fireEvent.click(switchControl());
    expect(wrapper()?.classList.contains("overflow-hidden")).toBe(true);
  });
});

describe("TrainingWeekEditor: the week", () => {
  const profile = { ...BASE, training: SCHEDULE };
  const week = plan(profile);

  it("shows each day's session and planned kcal, today marked", () => {
    renderEditor({ initial: profile });
    const wednesday = row("Wednesday");
    expect(wednesday.textContent).toContain("Lower");
    expect(wednesday.textContent).toContain("Hard · 18:00 · 75 min");
    expect(wednesday.textContent).toContain(
      fmt(week?.days[2]?.targetCalories ?? 0),
    );
    expect(row("Tuesday").textContent).toContain("No session");
    expect(row("Saturday").getAttribute("aria-current")).toBe("date");
    expect(row("Friday").getAttribute("aria-current")).toBeNull();
  });

  it("names the goal and its weekly rate beside the average", () => {
    renderEditor({ initial: profile });
    const current = week?.days[5];
    const mean = current?.training?.meanCalories ?? 0;
    // The average's own balance (after any safety cap), like the
    // Calculator's projection: 2,600 maintenance, a 0.5 kg/week ask.
    const rate = (Math.abs(current?.dailyDelta ?? 0) * 7) / 7700;
    expect(rate).toBeCloseTo(0.5, 1);
    expect(
      screen.getByRole("heading", {
        name: `${fmt(mean)} kcal daily average · Lose ${rate.toFixed(1)} kg/week`,
      }),
    ).toBeTruthy();
  });

  it("words the rate in the profile's units, and maintenance without one", () => {
    const { unmount } = renderEditor({
      initial: { ...profile, units: "imperial" },
    });
    expect(
      screen.getByRole("heading", {
        name: /daily average · Lose 1\.1 lb\/week$/,
      }),
    ).toBeTruthy();
    unmount();
    renderEditor({ initial: { ...profile, goal: "maintain" } });
    expect(
      screen.getByRole("heading", { name: /daily average · Maintain weight$/ }),
    ).toBeTruthy();
  });

  // A small frame whose safety floor is the 1,200 kcal minimum (BMR ≈ 1,158).
  const small: PersonalInfo = {
    ...profile,
    gender: "female",
    weight: 50,
    height: 155,
  };

  it("names the direction the average's balance takes, not the goal's ask", () => {
    // A cut from an 1,100 kcal maintenance is lifted to the 1,200 floor:
    // the week plans a small surplus, as the Calculator says.
    const lifted = { ...small, manualTdee: 1100 };
    expect(plan(lifted)?.days[5]?.dailyDelta).toBe(100);
    renderEditor({ initial: lifted });
    expect(
      screen.getByRole("heading", {
        name: /daily average · Gain 0\.1 kg\/week$/,
      }),
    ).toBeTruthy();
  });

  it("a balance that rounds to no change reads as maintenance", () => {
    // From 1,250 the floor leaves a 50 kcal deficit: 0.05 kg/week.
    const nearZero = { ...small, manualTdee: 1250 };
    expect(plan(nearZero)?.days[5]?.dailyDelta).toBe(-50);
    renderEditor({ initial: nearZero });
    expect(
      screen.getByRole("heading", { name: /daily average · Maintain weight$/ }),
    ).toBeTruthy();
  });

  it("words the rate to one decimal, as the rate field shows it", () => {
    // 0.25 kg/week reads 0.3, like Profile's rate field and the
    // Calculator's projection (both `kgToDisplay`).
    renderEditor({ initial: { ...profile, weeklyRateKg: 0.25 } });
    expect(
      screen.getByRole("heading", {
        name: /daily average · Lose 0\.3 kg\/week$/,
      }),
    ).toBeTruthy();
  });

  it("marks today like Today's week strip: a brand-outlined day tile", () => {
    renderEditor({ initial: profile });
    const tile = (day: string) =>
      within(row(day)).getByText(day.slice(0, 3)).parentElement;
    const today = tile("Saturday")?.className ?? "";
    expect(today).toContain("border-brand/40");
    expect(today).toContain("bg-brand/10");
    expect(within(row("Saturday")).getByText("Sat").className).toContain(
      "text-brand-text",
    );
    expect(tile("Friday")?.className).not.toContain("border-brand/40");
    // No second accent for the same idea (the cyan signal is the "now").
    expect(row("Saturday").querySelector("[class*='signal']")).toBeNull();
  });

  it("uses the width on desktop: the day list beside the chart and protein", () => {
    renderEditor({ initial: profile });
    const days = screen.getByRole("region", { name: "Weekly template" });
    const calories = screen
      .getByRole("radiogroup", { name: "Day-to-day difference" })
      .closest("section");
    const protein = screen.getByRole("region", { name: /Protein:/ });
    const grid = days.parentElement;
    // One two-column grid at lg: chart, cycling and protein on the left,
    // the seven days on the right; one column (in reading order) below lg.
    expect(grid?.className).toContain("lg:grid-cols-2");
    expect(calories?.parentElement).toBe(grid);
    expect(protein.parentElement).toBe(grid);
    expect(days.className).toContain("lg:col-start-2");
    expect(days.className).toContain("lg:row-start-1");
    // Not held to a narrow left-aligned column on a wide screen.
    const root = grid?.parentElement;
    expect(root?.className).toContain("max-w-2xl");
    expect(root?.className).toContain("lg:max-w-none");
  });

  it("a cycling preset change updates the planned kcal", () => {
    const onTraining = vi.fn();
    // At maintenance the safety floor leaves the full pronounced spread.
    const roomy: PersonalInfo = { ...profile, goal: "maintain" };
    renderEditor({ initial: roomy, onTraining });
    const modest = plan(roomy);
    const pronounced = plan({
      ...roomy,
      training: { ...SCHEDULE, cycling: "pronounced" },
    });
    // Tuesday is a rest day: pronounced cycling takes more from it.
    const before = modest?.days[1]?.targetCalories ?? 0;
    const after = pronounced?.days[1]?.targetCalories ?? 0;
    expect(after).toBeLessThan(before);
    expect(row("Tuesday").textContent).toContain(fmt(before));

    fireEvent.click(screen.getByRole("radio", { name: "Pronounced" }));
    expect(onTraining).toHaveBeenCalledWith({
      ...SCHEDULE,
      cycling: "pronounced",
    });
    expect(row("Tuesday").textContent).toContain(fmt(after));
    expect(screen.getByText(movesLine(floorOf(pronounced)))).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.getByText(offLine(floorOf(pronounced)))).toBeTruthy();
  });

  it("the chart's table alternative lists every day around the average", () => {
    renderEditor({ initial: profile });
    const table = screen.getByRole("table");
    const mean = week?.days[5]?.training?.meanCalories ?? 0;
    expect(table.querySelector("caption")?.textContent).toContain(fmt(mean));
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(8); // header + 7 days
    expect(rows[6]?.textContent).toContain("Saturday (today)");
  });
});

describe("TrainingWeekEditor: editing a day", () => {
  const profile = { ...BASE, training: SCHEDULE };

  it("edits one weekday through the sheet, previewing its planned kcal", async () => {
    const onTraining = vi.fn();
    renderEditor({ initial: profile, onTraining });
    fireEvent.click(row("Tuesday"));
    const dialog = await screen.findByRole("dialog", { name: "Tuesday" });

    fireEvent.click(within(dialog).getByRole("radio", { name: "HIIT" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Hard" }));
    fireEvent.change(within(dialog).getByLabelText("Start time"), {
      target: { value: "06:30" },
    });
    fireEvent.change(within(dialog).getByLabelText("Duration (min)"), {
      target: { value: "40" },
    });
    const edited = {
      type: "hiit",
      intensity: "hard",
      time: "06:30",
      durationMin: 40,
    } as const;
    const preview = plan({
      ...profile,
      training: withTrainingDay(SCHEDULE, 2, edited),
    });
    expect(
      within(dialog).getByText("HIIT · heavy day", { exact: false }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain(
      `${fmt(preview?.days[1]?.targetCalories ?? 0)} kcal planned`,
    );

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save Tuesday" }),
      );
    });
    expect(onTraining).toHaveBeenCalledWith(
      withTrainingDay(SCHEDULE, 2, edited),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(row("Tuesday").textContent).toContain("HIIT");
  });

  it("a rest day carries no session details; cancel writes nothing", async () => {
    const onTraining = vi.fn();
    renderEditor({ initial: profile, onTraining });
    fireEvent.click(row("Wednesday"));
    const dialog = await screen.findByRole("dialog", { name: "Wednesday" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Rest" }));
    // The session block stays (disabled), so the sheet keeps its height.
    const start = within(dialog).getByLabelText("Start time");
    expect(start.matches(":disabled")).toBe(true);
    expect(
      within(dialog).getByLabelText("Duration (min)").matches(":disabled"),
    ).toBe(true);
    for (const name of ["Light", "Moderate", "Hard"]) {
      expect(
        within(dialog).getByRole("radio", { name }).matches(":disabled"),
      ).toBe(true);
    }
    expect(
      within(dialog).getByText("A rest day has no session details."),
    ).toBeTruthy();
    // Back to a session, the fields are live again with the draft kept.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Lower" }));
    expect(start.matches(":disabled")).toBe(false);
    expect((start as HTMLInputElement).value).toBe("18:00");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Rest" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onTraining).not.toHaveBeenCalled();

    fireEvent.click(row("Wednesday"));
    const again = await screen.findByRole("dialog", { name: "Wednesday" });
    // Reopening starts from the stored session, not the abandoned draft.
    expect(
      within(again)
        .getByRole("radio", { name: "Lower" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(again).getByRole("radio", { name: "Rest" }));
    await act(async () => {
      fireEvent.click(
        within(again).getByRole("button", { name: "Save Wednesday" }),
      );
    });
    expect(onTraining).toHaveBeenCalledWith(
      withTrainingDay(SCHEDULE, 3, { type: "rest" }),
    );
  });

  it.each(["0", "1500", "45.5", "-30"])(
    "holds Save with a hint for a duration of %s, never dropping it",
    async (value) => {
      const onTraining = vi.fn();
      renderEditor({ initial: profile, onTraining });
      fireEvent.click(row("Monday"));
      const dialog = await screen.findByRole("dialog", { name: "Monday" });
      const duration = within(dialog).getByLabelText("Duration (min)");
      const save = within(dialog).getByRole("button", { name: "Save Monday" });
      fireEvent.change(duration, { target: { value } });

      expect(duration.getAttribute("aria-invalid")).toBe("true");
      const hint = document.getElementById(
        duration.getAttribute("aria-describedby") ?? "",
      );
      expect(hint?.textContent).toBe(
        "Enter whole minutes from 1 to 1,440, or leave it blank.",
      );
      expect(save.hasAttribute("disabled")).toBe(true);
      fireEvent.click(save);
      expect(onTraining).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Monday" })).toBeTruthy();

      // Cleared, the (optional) duration is simply left out.
      fireEvent.change(duration, { target: { value: "" } });
      expect(duration.getAttribute("aria-invalid")).toBe("false");
      expect(save.hasAttribute("disabled")).toBe(false);
      await act(async () => {
        fireEvent.click(save);
      });
      expect(onTraining).toHaveBeenCalledWith(
        withTrainingDay(SCHEDULE, 1, {
          type: "upper",
          intensity: "moderate",
          time: "18:00",
        }),
      );
    },
  );

  it("keeps a stored session's unset intensity unset", async () => {
    // Another client (or an older payload) can store a session without an
    // intensity; the engine classes `lower` without one as heavy.
    const stored = withTrainingDay(SCHEDULE, 3, { type: "lower" });
    const onTraining = vi.fn();
    renderEditor({ initial: { ...BASE, training: stored }, onTraining });
    fireEvent.click(row("Wednesday"));
    const dialog = await screen.findByRole("dialog", { name: "Wednesday" });
    for (const name of ["Light", "Moderate", "Hard"]) {
      expect(
        within(dialog)
          .getByRole("radio", { name })
          .getAttribute("aria-checked"),
      ).toBe("false");
    }
    expect(
      within(dialog).getByText("Lower · heavy day", { exact: false }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save Wednesday" }),
      );
    });
    expect(onTraining).toHaveBeenCalledWith(stored);
  });
});

describe("TrainingWeekEditor: protein", () => {
  const withSetting = (setting: ProteinSetting): PersonalInfo => ({
    ...BASE,
    training: SCHEDULE,
    proteinSetting: setting,
  });

  it("takes a typed g/kg in one go, either decimal mark, inside the safe range", () => {
    const onProtein = vi.fn();
    renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 1.2 }),
      onProtein,
    });
    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Grams per kg",
    });
    expect(field.value).toBe("1.2");
    expect(field.getAttribute("inputmode")).toBe("decimal");
    // 1.2 → 3.4 without 22 taps: type it, Enter.
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "3.4" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 3.4,
    });
    expect(field.value).toBe("3.4");
    expect(
      screen.getByRole("heading", { name: /Protein: 270 g/ }),
    ).toBeTruthy();
    // A comma works as the decimal mark; leaving the field commits.
    fireEvent.change(field, { target: { value: "2,6" } });
    fireEvent.blur(field);
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 2.6,
    });
    // Outside the range, the nearest bound; to a tenth.
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.blur(field);
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 3.4,
    });
    fireEvent.change(field, { target: { value: "1.84" } });
    fireEvent.blur(field);
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 1.8,
    });
    // Not a number: nothing is written and the setting shows again.
    const calls = onProtein.mock.calls.length;
    fireEvent.change(field, { target: { value: "lots" } });
    fireEvent.blur(field);
    expect(onProtein).toHaveBeenCalledTimes(calls);
    expect(field.value).toBe("1.8");
    // Escape drops a half-typed value.
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("1.8");
    fireEvent.blur(field);
    expect(onProtein).toHaveBeenCalledTimes(calls);
  });

  it("steps g/kg by 0.1 and shows the resulting grams", () => {
    const onProtein = vi.fn();
    renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 2.0 }),
      onProtein,
    });
    expect(screen.getByText("2.0 g/kg")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Protein: 160 g/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More protein" }));
    expect(onProtein).toHaveBeenCalledWith({
      basis: "bodyweight",
      gPerKg: 2.1,
    });
    expect(screen.getByText("2.1 g/kg")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Protein: 170 g/ }),
    ).toBeTruthy();
  });

  it("stays inside the engine's safe range, keeping focus at each bound", () => {
    const onProtein = vi.fn();
    renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 3.2 }),
      onProtein,
    });
    const more = screen.getByRole("button", { name: "More protein" });
    more.focus();
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByText("3.4 g/kg")).toBeTruthy();
    // At the maximum the focused button stays focusable and in place
    // (a native `disabled` would drop focus to <body>), and does nothing.
    expect(more.getAttribute("aria-disabled")).toBe("true");
    expect(more.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    expect(onProtein).toHaveBeenCalledTimes(2);
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 3.4,
    });

    const less = screen.getByRole("button", { name: "Less protein" });
    expect(less.getAttribute("aria-disabled")).toBe("false");
    less.focus();
    Array.from({ length: 25 }).forEach(() => fireEvent.click(less));
    expect(screen.getByText("1.2 g/kg")).toBeTruthy();
    expect(less.getAttribute("aria-disabled")).toBe("true");
    expect(less.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(less);
    expect(onProtein).toHaveBeenLastCalledWith({
      basis: "bodyweight",
      gPerKg: 1.2,
    });
    expect(more.getAttribute("aria-disabled")).toBe("false");
  });

  it("switching to lean mass caps g/kg at the lean-mass maximum", () => {
    const onProtein = vi.fn();
    renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 3.4 }),
      onProtein,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Lean mass" }));
    expect(onProtein).toHaveBeenCalledWith({ basis: "leanMass", gPerKg: 3.1 });
  });
});

describe("TrainingWeekEditor: notes from the engine's flags", () => {
  const profile = { ...BASE, training: SCHEDULE };

  it("no flags, no notes", () => {
    renderEditor({ initial: profile });
    expect(screen.queryByText(/body-fat estimate/)).toBeNull();
    expect(screen.queryByText(/healthy minimum/)).toBeNull();
    expect(screen.queryByText(/stays at the average/)).toBeNull();
  });

  it("lean mass without a body-fat estimate links to My measurements", () => {
    const onOpenMeasurements = vi.fn();
    renderEditor({
      initial: {
        ...profile,
        proteinSetting: { basis: "leanMass", gPerKg: 2.6 },
      },
      onOpenMeasurements,
    });
    expect(
      screen.getByText(
        "Lean mass needs a body-fat estimate. Until there is one, protein uses up to 2.0 g/kg of your bodyweight.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open My measurements" }),
    );
    expect(onOpenMeasurements).toHaveBeenCalledTimes(1);
  });

  it("lean mass above BMI 30 without an estimate names the reference weight", () => {
    renderEditor({
      initial: {
        ...profile,
        weight: 115,
        proteinSetting: { basis: "leanMass", gPerKg: 2.6 },
      },
    });
    expect(
      screen.getByText(
        "Lean mass needs a body-fat estimate. Until there is one, protein uses up to 2.0 g/kg of a reference weight for your height.",
      ),
    ).toBeTruthy();
  });

  it("the BMI reference weight suggests a body-fat estimate too", () => {
    // 180 cm at 115 kg: BMI ≈ 35.5, so protein is on the reference weight.
    renderEditor({ initial: { ...profile, weight: 115 } });
    expect(
      screen.getByText(
        "Protein is set from a reference weight for your height. With a body-fat estimate it would use your own bodyweight.",
      ),
    ).toBeTruthy();
  });

  /** A custom split with a 10% fat share, under the fat floor. */
  const lowFatSplit: PersonalInfo = {
    ...profile,
    macroSplit: { protein: 40, carbs: 50, fat: 10 },
    training: { ...SCHEDULE, cycling: "pronounced" },
  };
  const proteinCard = () => screen.getByRole("region", { name: /Protein:/ });

  /** The protein card's line under the stepper: the range, then what the
   *  week does with the macros (and, folded in, a lifted fat floor). */
  const macroLine = () =>
    within(proteinCard()).getByText(/protein stays the same|Every day plans/);

  it("a lifted fat choice on a carb-moving diet names the week's fat in the fat line", () => {
    const week = plan(lowFatSplit);
    expect(week?.days[5]?.training?.fatFloorLifted).toBe(true);
    const fats = [...new Set(week?.days.map((d) => d.fat))];
    expect(fats).toHaveLength(1); // carbs move; fat is held
    renderEditor({ initial: lowFatSplit });
    expect(macroLine().textContent).toBe(
      `1.2 to 3.4 g/kg. Carbs move with each day's calories; fat stays at ${fats[0]} g, a little above your chosen split to keep a healthy minimum, and protein stays the same.`,
    );
    // One line, not a second note repeating the fat figure.
    expect(within(proteinCard()).getAllByText(/healthy minimum/)).toHaveLength(
      1,
    );
    expect(within(proteinCard()).queryByText(/stays near/)).toBeNull();
  });

  it("a lifted fat choice on a low-carb diet names the held carbs, never one fat figure", () => {
    const lowCarb: PersonalInfo = { ...lowFatSplit, dietType: "lowCarb" };
    const week = plan(lowCarb);
    expect(week?.days[5]?.training?.fatFloorLifted).toBe(true);
    // Fat moves with each day's calories here; carbs are held.
    expect(new Set(week?.days.map((d) => d.fat)).size).toBeGreaterThan(1);
    const carbs = [...new Set(week?.days.map((d) => d.carbs))];
    expect(carbs).toHaveLength(1);
    renderEditor({ initial: lowCarb });
    expect(macroLine().textContent).toBe(
      `1.2 to 3.4 g/kg. Fat moves with each day's calories; carbs stay at ${carbs[0]} g, a little under your chosen split so fat keeps a healthy minimum, and protein stays the same.`,
    );
    expect(within(proteinCard()).getAllByText(/healthy minimum/)).toHaveLength(
      1,
    );
    expect(screen.queryByText(/Fat stays at/)).toBeNull();
  });

  it("a lifted fat choice on days that can't vary is folded into the same line", () => {
    const flat: PersonalInfo = {
      ...lowFatSplit,
      training: { ...lowFatSplit.training, cycling: "off" } as TrainingSchedule,
    };
    const week = plan(flat);
    expect(week?.days[5]?.training?.fatFloorLifted).toBe(true);
    renderEditor({ initial: flat });
    expect(macroLine().textContent).toBe(
      `1.2 to 3.4 g/kg. Every day plans the same protein, carbs and fat. Fat stays at ${week?.days[5]?.fat} g a day, a little above your chosen split, to keep a healthy minimum.`,
    );
  });

  it("the protein card names the macro the week holds", () => {
    const { unmount } = renderEditor({
      initial: { ...profile, training: { ...SCHEDULE, cycling: "pronounced" } },
    });
    expect(
      within(proteinCard()).getByText(
        /^Carbs move with each day's calories; fat stays near \d+ g and protein stays the same\.$/,
      ),
    ).toBeTruthy();
    unmount();
    renderEditor({
      initial: {
        ...profile,
        dietType: "lowCarb",
        training: { ...SCHEDULE, cycling: "pronounced" },
      },
    });
    expect(
      within(proteinCard()).getByText(
        /^Fat moves with each day's calories; carbs stay near \d+ g and protein stays the same\.$/,
      ),
    ).toBeTruthy();
  });
});

describe("TrainingWeekEditor: when the days can't vary", () => {
  /** The calorie card: the chart, the cycling control and its line. */
  const caloriesCard = () => {
    const card = screen
      .getByRole("radiogroup", { name: "Day-to-day difference" })
      .closest("section");
    if (!card) throw new Error("expected the calorie card");
    return card;
  };
  const MOVES = /^Calories move between days;/;
  const proteinCard = () => screen.getByRole("region", { name: /Protein:/ });

  it("an average at the safety floor says so under the control", () => {
    // A 1 kg/week cut from 2,600 is clamped to the 1,780 BMR floor.
    const atFloor: PersonalInfo = {
      ...BASE,
      weeklyRateKg: 1.0,
      training: SCHEDULE,
    };
    const week = plan(atFloor);
    expect(new Set(week?.days.map((d) => d.targetCalories))).toEqual(
      new Set([week?.days[0]?.bmr]),
    );
    renderEditor({ initial: atFloor });
    const line = `Your average is already close to your safety floor (${floorOf(week)} kcal), so every day stays at the average for now.`;
    expect(within(caloriesCard()).getByText(line)).toBeTruthy();
    expect(screen.queryByText(MOVES)).toBeNull();
    // A bigger spread can't change that, and the line keeps saying why.
    fireEvent.click(screen.getByRole("radio", { name: "Pronounced" }));
    expect(within(caloriesCard()).getByText(line)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(
      within(caloriesCard()).getByText(offLine(floorOf(week))),
    ).toBeTruthy();
  });

  it("a protein setting the average can't hold is explained at the control", () => {
    const heavy: PersonalInfo = {
      ...BASE,
      weight: 100,
      height: 190,
      weeklyRateKg: 1.0,
      proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
      training: SCHEDULE,
    };
    const today = plan(heavy)?.days[5];
    expect(today?.training?.floorsExceedMean).toBe("protein");
    // Protein gives way first: planned under what 3.4 g/kg asks for.
    const planned = today?.protein ?? 0;
    const asked = today?.training?.requestedProtein ?? 0;
    expect(planned).toBeLessThan(asked);
    renderEditor({ initial: heavy });
    expect(
      within(caloriesCard()).getByText(
        `Your protein setting leaves little room for the other minimums at this calorie level, so every day stays at the average and protein is held under your setting for now. A lower g/kg setting would let the days vary. No day goes under your safety floor (${floorOf(plan(heavy))} kcal).`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(MOVES)).toBeNull();
    // The protein card explains its heading against the stepper.
    const card = proteinCard();
    expect(
      within(card).getByRole("heading", {
        name: `Protein: ${fmt(planned)} g every day`,
      }),
    ).toBeTruthy();
    expect(within(card).getByText("3.4 g/kg")).toBeTruthy();
    expect(
      within(card).getByText(
        `Protein is planned at ${fmt(planned)} g a day for now, under the ${fmt(asked)} g your setting asks for, so the fat and carb minimums fit.`,
        { exact: false },
      ),
    ).toBeTruthy();
    expect(within(card).queryByText(/protein stays the same/)).toBeNull();
    expect(within(card).queryByText(/move with each day/)).toBeNull();
  });

  it("a calorie target the minimums don't fit says protein is held under the setting", () => {
    // 160 cm / 90 kg / 60 y sedentary woman with a 40% body-fat estimate,
    // cutting at her BMR floor: even 2.0 g/kg doesn't fit (engine output).
    const ctx = { phasesEnabled: false, bodyFatPct: 40 };
    const cutting: PersonalInfo = {
      ...BASE,
      gender: "female",
      age: 60,
      weight: 90,
      height: 160,
      activityLevel: "sedentary",
      weeklyRateKg: 0.9,
      manualTdee: null,
      proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
      training: SCHEDULE,
    };
    const planWeek = (p: PersonalInfo) => weekTargets(p, TODAY, ctx);
    const today = planWeek(cutting)?.days[5];
    expect(today?.training?.floorsExceedMean).toBe("calories");
    const planned = today?.protein ?? 0;
    const asked = today?.training?.requestedProtein ?? 0;
    expect([planned, asked]).toEqual([165, 305]);
    renderEditor({ initial: cutting, planWeek });
    expect(
      within(caloriesCard()).getByText(
        `Your calorie target leaves little room for the protein, fat and carb minimums together, so every day stays at the average and protein is held under your setting for now. A smaller deficit would give each day more room. No day goes under your safety floor (${floorOf(planWeek(cutting))} kcal).`,
      ),
    ).toBeTruthy();
    expect(
      within(proteinCard()).getByText(
        "Protein is planned at 165 g a day for now, under the 305 g your setting asks for, so the fat and carb minimums fit.",
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it("a calorie target the minimums don't fit is explained at the control", () => {
    renderEditor({
      initial: { ...BASE, training: SCHEDULE },
      planWeek: (p) => {
        const week = plan(p);
        if (!week) return null;
        return {
          ...week,
          days: week.days.map((d) =>
            d.training
              ? {
                  ...d,
                  targetCalories: d.training.meanCalories,
                  training: { ...d.training, floorsExceedMean: "calories" },
                }
              : d,
          ),
        };
      },
    });
    expect(
      within(caloriesCard()).getByText(
        /^Your calorie target leaves little room .* A smaller deficit would give each day more room\. No day goes under your safety floor \([\d,]+ kcal\)\.$/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/A lower g\/kg setting/)).toBeNull();
    expect(screen.queryByText(/held under your setting/)).toBeNull();
    expect(screen.queryByText(MOVES)).toBeNull();
    // Every day is the same, so nothing "moves" in the protein card.
    expect(
      within(proteinCard()).getByText(
        "Every day plans the same protein, carbs and fat.",
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it("a week of one kind of day says there is nothing to move", () => {
    const rest = { type: "rest" } as const;
    const allRest: TrainingSchedule = {
      ...SCHEDULE,
      days: [rest, rest, rest, rest, rest, rest, rest],
    };
    renderEditor({ initial: { ...BASE, training: allRest } });
    expect(
      within(caloriesCard()).getByText(
        /^Every day of your week plans the same way/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(MOVES)).toBeNull();
  });
});

describe("TrainingWeekEditor: stored data from a newer client", () => {
  it("an edit keeps a session type this build doesn't know", async () => {
    const onTraining = vi.fn();
    const stored = {
      ...SCHEDULE,
      days: SCHEDULE.days.map((d, i) =>
        i === 4 ? { type: "yoga", durationMin: 30 } : d,
      ),
    } as unknown as TrainingSchedule;
    renderEditor({ initial: { ...BASE, training: stored }, onTraining });
    // Read as rest here…
    expect(row("Thursday").textContent).toContain("No session");
    fireEvent.click(screen.getByRole("radio", { name: "Pronounced" }));
    // …but written back untouched.
    expect(onTraining).toHaveBeenCalledWith({
      ...stored,
      cycling: "pronounced",
    });
    expect(withTrainingEnabled(stored, true).days[4]).toEqual({
      type: "yoga",
      durationMin: 30,
    });
  });
});
