/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GoalPhase } from "./types";

// Pro tier so the planner renders its full UI rather than the upgrade card.
// `FEATURES.canUseGoalPhases` stays real ("pro" clears the bar).
vi.mock("@/hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: "pro", resolved: true }),
}));

afterEach(() => {
  cleanup();
});

const BASE = {
  phases: [] as GoalPhase[] | undefined,
  weightKg: 70,
  units: "metric" as const,
  today: "2026-06-04",
  goal: "lose" as const,
};

/** The new behaviour: applying a *cut* that paradoxically RAISES today's target
 *  is held behind a confirm; a cut that lowers (the normal case) applies
 *  straight through. `targetForPhases` is injected, so the test drives the
 *  before/after numbers directly without standing up the real macro pipeline. */
describe("GoalPhasesPlanner — rising-target warning", () => {
  // Empty list → 1800 kcal; any non-empty (the cut) → 2100 = a gentler cut
  // than the current deficit, i.e. the paradoxical rise.
  const risingTarget = (p: GoalPhase[]) => (p.length === 0 ? 1800 : 2100);

  it("warns before applying a cut that raises the target; Apply anyway commits", async () => {
    const onChange = vi.fn();
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        onChange={onChange}
        targetForPhases={risingTarget}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start a cut" }));

    // Held back behind the dialog — nothing committed yet.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/raises today/i);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply anyway" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const committed = onChange.mock.calls[0]?.[0] as GoalPhase[];
    expect(committed.some((p) => p.kind === "cut")).toBe(true);
  });

  it("Keep current dismisses the warning without committing", async () => {
    const onChange = vi.fn();
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        onChange={onChange}
        targetForPhases={risingTarget}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start a cut" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Keep current" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies directly (no warning) when the cut lowers the target", async () => {
    const onChange = vi.fn();
    // The normal case: a cut drops the target.
    const loweringTarget = (p: GoalPhase[]) => (p.length === 0 ? 2000 : 1700);
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        onChange={onChange}
        targetForPhases={loweringTarget}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start a cut" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("GoalPhasesPlanner — start date", () => {
  it("won't save a phase whose start date was cleared", async () => {
    const onChange = vi.fn();
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    const { container } = render(
      <GoalPhasesPlanner
        {...BASE}
        onChange={onChange}
        targetForPhases={() => 2000}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /build your own/i }));
    const start =
      container.querySelector<HTMLInputElement>('input[type="date"]');
    if (!start) throw new Error("start-date input not rendered");
    // What a cleared or half-typed date input reports.
    fireEvent.change(start, { target: { value: "" } });

    const save = screen.getByRole("button", { name: "Save phase" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(start.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(start.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toMatch(/start date/i);
    fireEvent.click(save);
    expect(onChange).not.toHaveBeenCalled();

    // A real date makes it savable again.
    fireEvent.change(start, { target: { value: "2026-06-10" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(start.hasAttribute("aria-invalid")).toBe(false);
    fireEvent.click(save);
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0]?.[0] as GoalPhase[];
    expect(saved.map((p) => p.startDate)).toEqual(["2026-06-10"]);
  });

  it("flags a missing date in the list instead of printing Invalid Date", async () => {
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        phases={[
          {
            id: "legacy",
            kind: "cut",
            startDate: "",
            durationWeeks: 4,
            weeklyRateKg: 0.3,
          },
        ]}
        onChange={vi.fn()}
        targetForPhases={() => 2000}
      />,
    );
    expect(screen.queryByText(/invalid date/i)).toBeNull();
    expect(screen.getByText(/dates can.t be read/i)).toBeTruthy();
  });
});

/** A phase without a valid window (e.g. a datetime start synced from an older
 *  client) is ignored by every schedule computation, so the list must say so
 *  instead of showing it like any other phase. */
describe("GoalPhasesPlanner — phases without valid dates", () => {
  const valid: GoalPhase = {
    id: "ph_ok",
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.4,
  };
  const broken: GoalPhase = {
    id: "ph_broken",
    kind: "leanBulk",
    startDate: "2026-06-01T08:00:00",
    durationWeeks: 4,
    weeklyRateKg: 0.2,
  };

  async function renderWith(phases: GoalPhase[]) {
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        phases={phases}
        onChange={vi.fn()}
        targetForPhases={() => 2000}
      />,
    );
  }

  it("flags it, and its Edit and Remove buttons say why", async () => {
    await renderWith([valid, broken]);
    const note = screen.getByText(/dates can.t be read/i);
    expect(note.textContent).toMatch(/isn.t used for your targets/i);
    expect(screen.queryByText(/invalid date/i)).toBeNull();

    const edit = screen.getByRole("button", { name: "Edit Lean bulk phase" });
    const remove = screen.getByRole("button", {
      name: "Remove Lean bulk phase",
    });
    expect(edit.getAttribute("aria-describedby")).toBe(note.id);
    expect(remove.getAttribute("aria-describedby")).toBe(note.id);
  });

  it("flags a cut whose weekly rate can't be read, never printing NaN", async () => {
    await renderWith([valid, { ...valid, id: "ph_nan", weeklyRateKg: NaN }]);
    const note = screen.getByText(/weekly rate can.t be read/i);
    expect(note.textContent).toMatch(/isn.t used for your targets/i);
    expect(screen.queryByText(/NaN/)).toBeNull();
    // Only the unreadable one is flagged; the valid cut stays as it was.
    const edits = screen.getAllByRole("button", { name: "Edit Cut phase" });
    expect(edits.map((b) => b.getAttribute("aria-describedby"))).toEqual([
      null,
      note.id,
    ]);
  });

  it("leaves phases with valid dates unflagged", async () => {
    await renderWith([valid]);
    expect(screen.queryByText(/dates can.t be read/i)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Edit Cut phase" })
        .hasAttribute("aria-describedby"),
    ).toBe(false);
  });
});

/** The list's "Edit or remove it" note must lead to a real fix: the editor
 *  never renders NaN, says what is missing, and only saves a phase with a
 *  valid window (core `phaseHasValidWindow`). */
describe("GoalPhasesPlanner — editing a phase without a valid window", () => {
  const unreadable: GoalPhase = {
    id: "ph_unreadable",
    kind: "leanBulk",
    startDate: "2026-06-01T08:00:00",
    durationWeeks: Number.NaN,
    weeklyRateKg: Number.NaN,
  };
  const valid: GoalPhase = {
    id: "ph_ok",
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.4,
  };

  async function editPhase(phase: GoalPhase, onChange = vi.fn()) {
    const { GoalPhasesPlanner } = await import("./GoalPhasesPlanner");
    render(
      <GoalPhasesPlanner
        {...BASE}
        phases={[phase]}
        onChange={onChange}
        targetForPhases={() => 2000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit .* phase$/ }));
    return {
      onChange,
      start: screen.getByLabelText("Starts") as HTMLInputElement,
      weeks: screen.getByLabelText("Weeks") as HTMLInputElement,
      rate: screen.queryByLabelText(/^Rate/) as HTMLInputElement | null,
      save: screen.getByRole("button", { name: "Save phase" }),
    };
  }

  it("opens without NaN in any input, says what is missing, and can't be saved", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { start, weeks, rate, save } = await editPhase(unreadable);

    // React warns when it is handed NaN for an input's value.
    expect(
      consoleError.mock.calls.some((args) =>
        args.map(String).join(" ").includes("NaN"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
    expect(weeks.value).toBe("");
    expect(start.value).toBe("");
    expect(rate?.value).toBe("");

    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(weeks.getAttribute("aria-invalid")).toBe("true");
    expect(rate?.getAttribute("aria-invalid")).toBe("true");
    const messageId = start.getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    expect(weeks.getAttribute("aria-describedby")).toBe(messageId);
    expect(rate?.getAttribute("aria-describedby")).toBe(messageId);
    const message = document.getElementById(messageId ?? "");
    // Announced as it changes, without moving focus.
    expect(message?.getAttribute("aria-live")).toBe("polite");
    expect(message?.textContent).toMatch(/start date/i);
    expect(message?.textContent).toMatch(/weeks/i);
    expect(message?.textContent).toMatch(/weekly rate/i);

    expect(save).toHaveProperty("disabled", true);
  });

  it("saves once the window and the rate are valid", async () => {
    const { start, weeks, rate, save, onChange } = await editPhase(unreadable);
    fireEvent.change(start, { target: { value: "2026-07-01" } });
    expect(save).toHaveProperty("disabled", true);
    expect(weeks.getAttribute("aria-invalid")).toBe("true");
    expect(start.hasAttribute("aria-invalid")).toBe(false);

    fireEvent.change(weeks, { target: { value: "6" } });
    expect(weeks.hasAttribute("aria-invalid")).toBe(false);
    // A lean bulk with an unreadable rate would compute NaN targets.
    expect(save).toHaveProperty("disabled", true);
    expect(rate?.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(rate as HTMLInputElement, { target: { value: "0.3" } });
    expect(save).toHaveProperty("disabled", false);
    expect(rate?.hasAttribute("aria-invalid")).toBe(false);
    expect(
      screen.queryByText(/start date|how many weeks|weekly rate/i),
    ).toBeNull();

    fireEvent.click(save);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [saved] = onChange.mock.calls[0]?.[0] as GoalPhase[];
    expect(saved).toMatchObject({
      id: "ph_unreadable",
      startDate: "2026-07-01",
      durationWeeks: 6,
      weeklyRateKg: 0.3,
    });
  });

  it("an unreadable rate doesn't block a kind that has no rate", async () => {
    const { start, weeks, save, onChange } = await editPhase({
      ...unreadable,
      kind: "maintenance",
    });
    expect(screen.queryByLabelText(/^Rate/)).toBeNull();
    fireEvent.change(start, { target: { value: "2026-07-01" } });
    fireEvent.change(weeks, { target: { value: "6" } });
    expect(save).toHaveProperty("disabled", false);

    fireEvent.click(save);
    const [saved] = onChange.mock.calls[0]?.[0] as GoalPhase[];
    expect(saved?.weeklyRateKg).toBe(0);
  });

  it("a valid phase opens without a message and can be saved", async () => {
    const { start, weeks, save } = await editPhase(valid);
    expect(start.hasAttribute("aria-invalid")).toBe(false);
    expect(weeks.hasAttribute("aria-invalid")).toBe(false);
    expect(save).toHaveProperty("disabled", false);
  });

  it("clearing a field of a valid phase blocks saving until it is filled in", async () => {
    const { start, weeks, save } = await editPhase(valid);
    fireEvent.change(weeks, { target: { value: "" } });
    expect(weeks.value).toBe("");
    expect(save).toHaveProperty("disabled", true);
    expect(weeks.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(weeks, { target: { value: "0" } });
    expect(save).toHaveProperty("disabled", true);

    fireEvent.change(weeks, { target: { value: "3" } });
    fireEvent.change(start, { target: { value: "" } });
    expect(save).toHaveProperty("disabled", true);
    expect(start.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(start, { target: { value: "2026-06-01" } });
    expect(save).toHaveProperty("disabled", false);
  });

  it("clearing the rate of a valid phase blocks saving until it is filled in", async () => {
    const { rate, save } = await editPhase(valid);
    const field = rate as HTMLInputElement;
    expect(field.value).toBe("0.4");

    fireEvent.change(field, { target: { value: "" } });
    expect(field.value).toBe("");
    expect(save).toHaveProperty("disabled", true);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/weekly rate/i)).toBeTruthy();

    fireEvent.change(field, { target: { value: "0.5" } });
    expect(save).toHaveProperty("disabled", false);
  });
});
