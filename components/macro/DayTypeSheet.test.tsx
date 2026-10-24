/**
 * @vitest-environment jsdom
 */
import { TodayHeader } from "@/components/today/TodayHeader";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DateTargets,
  type TargetContext,
  dayOverrideResolver,
  targetsForDate,
} from "@maqro/core/targets";
import type { PersonalInfo, TrainingDay } from "@maqro/core/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DayTypeSheet } from "./DayTypeSheet";

const writes = vi.hoisted(() => ({
  setOverride: vi.fn<(date: string, day: unknown) => Promise<boolean>>(),
  clearOverride: vi.fn<(date: string) => Promise<boolean>>(),
}));
vi.mock("@/hooks/use-day-overrides", () => ({
  useDayOverrides: () => ({
    overrides: [],
    loaded: true,
    setOverride: writes.setOverride,
    clearOverride: writes.clearOverride,
  }),
}));

/** Wednesday — a hard lower-body day in the template. */
const WED = "2026-10-21";
const THU = "2026-10-22";

/** The mockup: 80 kg cutting to a 2,200 kcal weekly mean; Wednesday plans
 *  2,500 kcal, a rest day 1,950 (lib/targets.test.ts). */
const PROFILE: PersonalInfo = {
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
  weeklyRateKg: 0.4,
  manualTdee: 2640,
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
      { type: "fullBody", intensity: "moderate", time: "07:00" },
      { type: "endurance", intensity: "moderate", durationMin: 90 },
    ],
  },
};
const FREE: TargetContext = { phasesEnabled: false };

/** What `useTargets` gives the day view for `date` with `stored` rows. */
function app(stored: { date: string; day: TrainingDay }[] = []) {
  const ctx = { ...FREE, overrideFor: dayOverrideResolver(stored) };
  return {
    targetsFor: (date: string) => targetsForDate(PROFILE, date, ctx),
    previewDayTargets: vi.fn((date: string, day: TrainingDay | null) =>
      targetsForDate(PROFILE, date, {
        ...FREE,
        overrideFor: (d) => (d === date ? day : ctx.overrideFor(d)),
      }),
    ),
  };
}

/** The app's wiring (macro-calculator): Today's header chip opens the
 *  sheet for the shown day, mounted per open. */
function ChipAndSheet({
  targets,
  preview,
}: {
  targets: DateTargets;
  preview: (date: string, day: TrainingDay | null) => DateTargets;
}) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLElement | null>(null);
  return (
    <>
      <TodayHeader
        date={targets.date}
        today={WED}
        training={targets.training}
        titleId="day-title"
        onSelectDate={vi.fn()}
        onEditDayType={(trigger) => {
          chip.current = trigger;
          setOpen(true);
        }}
      />
      {open && (
        <DayTypeSheet
          targets={targets}
          today={WED}
          previewDayTargets={preview}
          onOpenChange={setOpen}
          returnFocusTo={chip}
        />
      )}
    </>
  );
}

function renderRow(targets: DateTargets, preview = app().previewDayTargets) {
  return render(
    <ChipAndSheet
      targets={targets}
      preview={preview}
    />,
    { wrapper: intlWrapper() },
  );
}

async function openSheet(name = /change today’s session/i) {
  const change = screen.getByRole("button", { name });
  change.focus();
  fireEvent.click(change);
  return screen.findByRole("dialog");
}

beforeEach(() => {
  writes.setOverride.mockReset().mockResolvedValue(true);
  writes.clearOverride.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("Today's session chip", () => {
  it("offers no change while training is off", () => {
    const off = targetsForDate(
      { ...PROFILE, training: { ...PROFILE.training!, enabled: false } },
      WED,
      FREE,
    );
    renderRow(off);
    expect(screen.queryByRole("button", { name: /session/i })).toBeNull();
  });

  it("is the one control that changes the shown day's session", () => {
    renderRow(app().targetsFor(WED));
    expect(
      screen.getByRole("button", {
        name: "Lower, heavy day, 18:00, 75 min. Change today’s session",
      }),
    ).toBeTruthy();
  });

  it("names another day by its weekday", () => {
    renderRow(app().targetsFor(THU));
    expect(
      screen.getByRole("button", {
        name: "Rest day. Change Thursday’s session",
      }),
    ).toBeTruthy();
  });

  it("shows a changed day as changed", () => {
    const { targetsFor } = app([{ date: WED, day: { type: "rest" } }]);
    renderRow(targetsFor(WED));
    expect(
      screen.getByRole("button", {
        name: "Rest day, changed from the plan. Change today’s session",
      }).textContent,
    ).toBe("Rest day· changed");
  });
});

describe("DayTypeSheet", () => {
  it("shows the plan, previews a rest day through the resolver and saves it", async () => {
    const { targetsFor, previewDayTargets } = app();
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();

    expect(within(sheet).getByRole("heading").textContent).toBe(
      "Today’s session",
    );
    expect(sheet.textContent).toContain(
      "Planned: Lower body · Hard · 18:00 · 75\u00a0min",
    );
    expect(sheet.textContent).toContain("2,500 kcal");

    fireEvent.click(within(sheet).getByRole("radio", { name: "Rest" }));

    // The SAME resolver the app uses, for this date and session.
    expect(previewDayTargets).toHaveBeenLastCalledWith(WED, { type: "rest" });
    const target = within(sheet).getByRole("group", { name: "Calorie target" });
    expect(target.textContent).toContain("2,500");
    expect(target.textContent).toContain("1,950 kcal");
    expect(target.textContent).toContain("Rest day");
    expect(target.textContent).toContain("160 g protein");
    expect(sheet.textContent).toContain("Changes this day only.");

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(writes.setOverride).toHaveBeenCalledWith(WED, { type: "rest" });
    expect(writes.clearOverride).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus goes back to the chip that opened the sheet (Radix restores it
    // on the next task after the content unmounts).
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /change today’s session/i }),
      ),
    );
  });

  it("saves a full session for a rest day", async () => {
    const { targetsFor, previewDayTargets } = app();
    renderRow(targetsFor(THU), previewDayTargets);
    const sheet = await openSheet(/change thursday’s session/i);

    fireEvent.click(within(sheet).getByRole("radio", { name: "Lower body" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "Hard" }));
    fireEvent.change(within(sheet).getByLabelText("Start time"), {
      target: { value: "18:30" },
    });
    fireEvent.change(within(sheet).getByLabelText("Duration (min)"), {
      target: { value: "70" },
    });
    expect(
      within(sheet).getByRole("group", { name: "Calorie target" }).textContent,
    ).toContain("1,950");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(writes.setOverride).toHaveBeenCalledWith(THU, {
      type: "lower",
      intensity: "hard",
      time: "18:30",
      durationMin: 70,
    });
  });

  it("back to plan removes the override", async () => {
    const { targetsFor, previewDayTargets } = app([
      { date: WED, day: { type: "rest" } },
    ]);
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();
    expect(sheet.textContent).toContain("1,950 kcal");

    await act(async () => {
      fireEvent.click(
        within(sheet).getByRole("button", { name: "Back to plan" }),
      );
    });

    expect(writes.clearOverride).toHaveBeenCalledWith(WED);
    expect(writes.setOverride).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("choosing the planned session again is back to plan, not a copy of it", async () => {
    const { targetsFor, previewDayTargets } = app([
      { date: WED, day: { type: "rest" } },
    ]);
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Lower body" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "Hard" }));
    fireEvent.change(within(sheet).getByLabelText("Start time"), {
      target: { value: "18:00" },
    });
    fireEvent.change(within(sheet).getByLabelText("Duration (min)"), {
      target: { value: "75" },
    });
    // The plan's own target: no override in the preview.
    expect(previewDayTargets).toHaveBeenLastCalledWith(WED, null);

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(writes.clearOverride).toHaveBeenCalledWith(WED);
    expect(writes.setOverride).not.toHaveBeenCalled();
  });

  it("saving the unchanged plan writes nothing", async () => {
    const { targetsFor, previewDayTargets } = app();
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();
    expect(
      within(sheet).queryByRole("button", { name: "Back to plan" }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(writes.setOverride).not.toHaveBeenCalled();
    expect(writes.clearOverride).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saving an unchanged override writes nothing", async () => {
    const { targetsFor, previewDayTargets } = app([
      { date: WED, day: { type: "rest" } },
    ]);
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    // A rewrite of the same row would count as a pending change.
    expect(writes.setOverride).not.toHaveBeenCalled();
    expect(writes.clearOverride).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds Save while the duration is invalid, never dropping it", async () => {
    const { targetsFor, previewDayTargets } = app();
    renderRow(targetsFor(THU), previewDayTargets);
    const sheet = await openSheet(/change thursday’s session/i);
    fireEvent.click(within(sheet).getByRole("radio", { name: "Lower body" }));
    const duration = within(sheet).getByLabelText("Duration (min)");
    const save = within(sheet).getByRole("button", { name: "Save" });

    fireEvent.change(duration, { target: { value: "0" } });
    expect(duration.getAttribute("aria-invalid")).toBe("true");
    expect(save).toHaveProperty("disabled", true);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(writes.setOverride).not.toHaveBeenCalled();

    fireEvent.change(duration, { target: { value: "" } });
    expect(save).toHaveProperty("disabled", false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(writes.setOverride).toHaveBeenCalledWith(THU, { type: "lower" });
  });

  it("keeps a planned session without an intensity as planned", async () => {
    const plain: PersonalInfo = {
      ...PROFILE,
      training: {
        enabled: true,
        cycling: "modest",
        days: [
          { type: "rest" },
          { type: "upper", intensity: "moderate" },
          { type: "rest" },
          { type: "lower" },
          { type: "rest" },
          { type: "fullBody", intensity: "moderate" },
          { type: "rest" },
        ],
      },
    };
    renderRow(
      targetsForDate(plain, WED, FREE),
      vi.fn((date: string, day: TrainingDay | null) =>
        targetsForDate(plain, date, {
          ...FREE,
          overrideFor: (d) => (d === date ? day : undefined),
        }),
      ),
    );
    const sheet = await openSheet();
    // No intensity is picked for it, and none is invented on save.
    const intensity = within(sheet).getByRole("radiogroup", {
      name: "Intensity",
    });
    expect(
      within(intensity).queryByRole("radio", { checked: true }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(writes.setOverride).not.toHaveBeenCalled();
    expect(writes.clearOverride).not.toHaveBeenCalled();
  });

  it("keeps the sheet open and says so when the change can't be stored", async () => {
    writes.setOverride.mockResolvedValue(false);
    const { targetsFor, previewDayTargets } = app();
    renderRow(targetsFor(WED), previewDayTargets);
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Rest" }));

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("dialog")).toBe(sheet);
    expect(within(sheet).getByRole("alert").textContent).toContain(
      "couldn’t be saved",
    );
  });
});
