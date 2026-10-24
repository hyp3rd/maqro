/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type TrainingDayTargets,
  type WeekTargets,
  weekTargets,
} from "@maqro/core/targets";
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
    expect(switchControl().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();

    fireEvent.click(switchControl());
    expect(onTraining).toHaveBeenCalledWith(defaultTrainingSchedule());
    expect(switchControl().getAttribute("aria-checked")).toBe("true");
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
    fireEvent.click(switchControl());
    expect(onTraining).toHaveBeenLastCalledWith(SCHEDULE);
  });
});

describe("TrainingWeekEditor: the week", () => {
  const profile = { ...BASE, training: SCHEDULE };
  const week = plan(profile);

  it("shows each day's session and planned kcal, today marked", () => {
    renderEditor({ initial: profile });
    const wednesday = row("Wednesday");
    expect(wednesday.textContent).toContain("Lower body");
    expect(wednesday.textContent).toContain("Hard · 18:00 · 75 min");
    expect(wednesday.textContent).toContain(
      fmt(week?.days[2]?.targetCalories ?? 0),
    );
    expect(row("Tuesday").textContent).toContain("No session");
    expect(row("Saturday").getAttribute("aria-current")).toBe("date");
    expect(row("Friday").getAttribute("aria-current")).toBeNull();
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
    expect(
      screen.getByText(
        "Calories move between days; your weekly average stays the same.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(
      screen.getByText("Every day stays at your weekly average."),
    ).toBeTruthy();
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
      within(dialog).getByText("Heavy training day", { exact: false }),
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
    expect(within(dialog).queryByLabelText("Start time")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onTraining).not.toHaveBeenCalled();

    fireEvent.click(row("Wednesday"));
    const again = await screen.findByRole("dialog", { name: "Wednesday" });
    // Reopening starts from the stored session, not the abandoned draft.
    expect(
      within(again)
        .getByRole("radio", { name: "Lower body" })
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
      within(dialog).getByText("Heavy training day", { exact: false }),
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

  it("stays inside the engine's safe range", () => {
    const { unmount } = renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 3.4 }),
    });
    expect(
      screen
        .getByRole("button", { name: "More protein" })
        .hasAttribute("disabled"),
    ).toBe(true);
    unmount();
    renderEditor({
      initial: withSetting({ basis: "bodyweight", gPerKg: 1.2 }),
    });
    expect(
      screen
        .getByRole("button", { name: "Less protein" })
        .hasAttribute("disabled"),
    ).toBe(true);
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
  /** The real week, with today's training flags overridden. */
  const flagged =
    (flags: Partial<TrainingDayTargets>) =>
    (p: PersonalInfo): WeekTargets | null => {
      const week = plan(p);
      if (!week) return null;
      return {
        ...week,
        days: week.days.map((d) =>
          d.training ? { ...d, training: { ...d.training, ...flags } } : d,
        ),
      };
    };
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
      screen.getByText(/Lean mass needs a body-fat estimate/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add measurements in My measurements",
      }),
    );
    expect(onOpenMeasurements).toHaveBeenCalledTimes(1);
  });

  it("the BMI reference weight suggests a body-fat estimate too", () => {
    // 180 cm at 115 kg: BMI ≈ 35.5, so protein is on the reference weight.
    renderEditor({ initial: { ...profile, weight: 115 } });
    expect(screen.getByText(/reference weight for your height/)).toBeTruthy();
  });

  it("a fat floor that lifted an explicit choice is an info note with the grams", () => {
    renderEditor({
      initial: profile,
      planWeek: flagged({ fatFloorLifted: true }),
    });
    const fat = plan(profile)?.days[5]?.fat ?? 0;
    const note = screen.getByText(/a little above your chosen split/);
    expect(note.textContent).toContain(`${fat} g`);
  });

  it("floors over the mean are worded by their cause", () => {
    const { unmount } = renderEditor({
      initial: profile,
      planWeek: flagged({ floorsExceedMean: "protein" }),
    });
    expect(screen.getByText(/A lower g\/kg setting/)).toBeTruthy();
    unmount();
    renderEditor({
      initial: profile,
      planWeek: flagged({ floorsExceedMean: "calories" }),
    });
    expect(screen.getByText(/A smaller deficit/)).toBeTruthy();
    expect(screen.queryByText(/A lower g\/kg setting/)).toBeNull();
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
