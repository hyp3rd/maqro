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
