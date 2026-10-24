/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MacroReadout } from "./MacroReadout";

afterEach(() => cleanup());

const TARGETS = { targetCalories: 2500, protein: 160, carbs: 308, fat: 70 };

function rows() {
  return screen
    .getAllByRole("term")
    .map((dt) => (dt.parentElement?.textContent ?? "").replace(/\s+/g, " "));
}

describe("MacroReadout", () => {
  it("reads eaten / target for energy and each macro, with what is left", () => {
    render(
      <MacroReadout
        eaten={{ calories: 1240, protein: 85, carbs: 140, fat: 38 }}
        targets={TARGETS}
      />,
      { wrapper: intlWrapper() },
    );
    expect(rows()).toEqual([
      "Eaten1,240 / 2,500 kcal",
      "Protein85 / 160 g75 g left",
      "Carbs140 / 308 g168 g left",
      "Fat38 / 70 g32 g left",
    ]);
  });

  it("states a macro past its target as a neutral '+N', never a warning", () => {
    const { container } = render(
      <MacroReadout
        eaten={{ calories: 2610, protein: 172.4, carbs: 300, fat: 70.2 }}
        targets={TARGETS}
      />,
      { wrapper: intlWrapper() },
    );
    const protein = screen.getByText("Protein").closest("div");
    expect(protein).not.toBeNull();
    const over = within(protein as HTMLElement).getByText("+12 g");
    expect(over.className).toContain("text-muted-foreground");
    // Rounded before comparing: 70.2 of 70 reads "70 / 70 g", on target.
    expect(rows()[3]).toBe("Fat70 / 70 gon target");
    expect(container.innerHTML).not.toMatch(
      /destructive|warning|success|amber|emerald|red-|rose-/,
    );
  });

  it("formats every figure for the app locale", () => {
    render(
      <MacroReadout
        eaten={{ calories: 1240, protein: 85, carbs: 140, fat: 38 }}
        targets={TARGETS}
      />,
      { wrapper: intlWrapper("it") },
    );
    // Italian groups from five digits (CLDR minimum grouping digits).
    expect(rows()[0]).toBe("Eaten1240 / 2500 kcal");
  });

  it("drops the '/ target' while there is no target yet", () => {
    render(
      <MacroReadout
        eaten={{ calories: 830, protein: 40, carbs: 90, fat: 20 }}
        targets={{ targetCalories: 0, protein: 0, carbs: 0, fat: 0 }}
      />,
      { wrapper: intlWrapper() },
    );
    expect(rows()[0]).toBe("Eaten830 kcal");
    expect(rows()[1]).toBe("Protein40 g");
  });
});
