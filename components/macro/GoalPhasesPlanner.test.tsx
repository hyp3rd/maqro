/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GoalPhase } from "./types";

// Pro tier so the planner renders its full UI rather than the upgrade card.
// `FEATURES.canUseGoalPhases` stays real ("pro" clears the bar).
vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: { status: "ok", data: { tier: "pro" } } }),
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
    expect(screen.getByText(/pick a start date/i)).toBeTruthy();
    fireEvent.click(save);
    expect(onChange).not.toHaveBeenCalled();

    // A real date makes it savable again.
    fireEvent.change(start, { target: { value: "2026-06-10" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(start.getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(save);
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0]?.[0] as GoalPhase[];
    expect(saved.map((p) => p.startDate)).toEqual(["2026-06-10"]);
  });

  it("names a missing date in the list instead of printing Invalid Date", async () => {
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
    expect(screen.getByText(/no date →/)).toBeTruthy();
  });
});
