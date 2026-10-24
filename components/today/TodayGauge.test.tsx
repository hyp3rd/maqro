/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { ENERGY_RING, circumference } from "@/lib/today/gauge";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TodayGauge } from "./TodayGauge";

afterEach(() => cleanup());

const TARGETS = { targetCalories: 2500, protein: 160, carbs: 308, fat: 70 };

function renderGauge(
  eaten: { calories: number; protein: number; carbs: number; fat: number },
  when: "past" | "today" | "future" = "today",
  locale: "en" | "it" = "en",
) {
  return render(
    <TodayGauge
      eaten={eaten}
      targets={TARGETS}
      when={when}
    />,
    { wrapper: intlWrapper(locale) },
  );
}

const ring = (container: HTMLElement, name: string, part: string) =>
  container.querySelector<SVGCircleElement>(
    `[data-ring="${name}"][data-part="${part}"]`,
  );

describe("TodayGauge", () => {
  it("states kcal left in the centre, grouped for the locale", () => {
    renderGauge({ calories: 1240, protein: 85, carbs: 140, fat: 38 });
    expect(screen.getByRole("status").textContent).toBe(
      "1,260 kcal left today",
    );
    cleanup();
    renderGauge(
      { calories: 1240, protein: 85, carbs: 140, fat: 38 },
      "today",
      "it",
    );
    // Italian groups from five digits (CLDR minimum grouping digits).
    expect(screen.getByRole("status").textContent).toBe("1260 kcal left today");
  });

  it("keeps the day-aware wording for past and future days", () => {
    renderGauge({ calories: 1240, protein: 0, carbs: 0, fat: 0 }, "past");
    expect(screen.getByRole("status").textContent).toBe(
      "1,260 kcal under target",
    );
    cleanup();
    renderGauge({ calories: 1240, protein: 0, carbs: 0, fat: 0 }, "future");
    expect(screen.getByRole("status").textContent).toBe("1,260 kcal to plan");
  });

  it("draws the energy arc and the three macro arcs against the day's targets", () => {
    const { container } = renderGauge({
      calories: 1240,
      protein: 85,
      carbs: 140,
      fat: 38,
    });
    const energy = ring(container, "energy", "solid");
    const [len] = (energy?.getAttribute("stroke-dasharray") ?? "")
      .split(" ")
      .map(Number);
    expect(len).toBeCloseTo(
      (1240 / 2500) * circumference(ENERGY_RING.radius),
      2,
    );
    for (const macro of ["protein", "carbs", "fat"]) {
      expect(ring(container, macro, "solid")).not.toBeNull();
      expect(ring(container, macro, "over")).toBeNull();
    }
    // Decorative: the readout beside it carries the figures.
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("shows an overshoot calmly: same hue, lower intensity, a neutral 'over'", () => {
    const { container } = renderGauge({
      calories: 2610,
      protein: 150,
      carbs: 330,
      fat: 60,
    });
    expect(screen.getByRole("status").textContent).toBe("110 kcal over");
    const over = ring(container, "energy", "over");
    expect(over).not.toBeNull();
    expect(over?.getAttribute("class")).toContain("stroke-brand/40");
    expect(ring(container, "carbs", "over")?.getAttribute("class")).toContain(
      "stroke-macro-carbs/40",
    );
    expect(container.innerHTML).not.toMatch(
      /destructive|warning|success|amber|emerald|red-|rose-/,
    );
  });

  it("shows the day's target before anything is logged", () => {
    renderGauge({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(screen.getByRole("status").textContent).toBe("2,500 kcal target");
  });
});
