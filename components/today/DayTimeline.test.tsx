/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meal } from "@maqro/core/types";
import { cleanup, render, screen } from "@testing-library/react";
import { DayTimeline } from "./DayTimeline";

afterEach(() => cleanup());

const DAY = "2026-10-21";
const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).getTime();
const food = (id: number, calories: number, loggedAt?: number) => ({
  id,
  name: "food",
  protein: 0,
  carbs: 0,
  fat: 0,
  calories,
  portionSize: 100,
  ...(loggedAt === undefined ? {} : { loggedAt }),
});
const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [food(1, 520, at(7, 30))] },
  { id: 2, name: "Lunch", foods: [food(2, 720, at(12, 45))] },
  { id: 3, name: "Dinner", foods: [food(3, 600)] },
  { id: 4, name: "Snacks", foods: [] },
];
const LOWER = {
  day: {
    type: "lower" as const,
    intensity: "hard" as const,
    time: "18:00",
    durationMin: 75,
  },
  dayClass: "heavy" as const,
};

const left = (el: Element | null) =>
  Number.parseFloat((el as HTMLElement | null)?.style.left ?? "NaN");
const width = (el: Element | null) =>
  Number.parseFloat((el as HTMLElement | null)?.style.width ?? "NaN");

describe("DayTimeline", () => {
  it("never prints a crowded kcal label over another", () => {
    const crowded: Meal[] = [
      { id: 1, name: "Breakfast", foods: [food(1, 1340, at(12, 0))] },
      { id: 2, name: "Lunch", foods: [food(2, 1340, at(12, 40))] },
      { id: 3, name: "Dinner", foods: [food(3, 1340, at(13, 20))] },
    ];
    const { container } = render(
      <DayTimeline
        meals={crowded}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper() },
    );
    // Three ticks, two labels; the summary still names all three.
    expect(container.querySelectorAll("[data-part=meal-tick]")).toHaveLength(3);
    expect(screen.getAllByText("1,340")).toHaveLength(2);
    expect(
      screen.getByRole("img").getAttribute("aria-label")?.match(/1,340/g),
    ).toHaveLength(3);
  });

  it("prints the meal kcal for the app locale", () => {
    const heavy: Meal[] = [
      { id: 1, name: "Lunch", foods: [food(1, 1050, at(12, 45))] },
    ];
    render(
      <DayTimeline
        meals={heavy}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper("en") },
    );
    expect(screen.getByText("1,050")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Day timeline: Lunch at 12:45, 1,050 kcal. Now 15:10.",
      }),
    ).toBeTruthy();
  });

  it("draws 24 hours of ticks with the elapsed part of today lit", () => {
    const { container } = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
        training={LOWER}
      />,
      { wrapper: intlWrapper() },
    );
    expect(container.querySelectorAll("[data-part=hour-tick]")).toHaveLength(
      25,
    );
    expect(width(container.querySelector("[data-part=elapsed]"))).toBeCloseTo(
      (910 / 1440) * 100,
      6,
    );
  });

  it("places each timed meal at its first logged food, labelled with its kcal", () => {
    const { container } = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper() },
    );
    const ticks = container.querySelectorAll("[data-part=meal-tick]");
    expect(ticks).toHaveLength(2);
    expect(left(ticks[0] ?? null)).toBeCloseTo((450 / 1440) * 100, 6);
    expect(left(ticks[1] ?? null)).toBeCloseTo((765 / 1440) * 100, 6);
    expect(screen.getByText("520")).toBeTruthy();
    expect(screen.getByText("720")).toBeTruthy();
  });

  it("puts a 'Now' cursor at the current minute, today only", () => {
    const { container } = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper() },
    );
    expect(left(container.querySelector("[data-part=now]"))).toBeCloseTo(
      (910 / 1440) * 100,
      6,
    );
    // Unmeasured (the narrowest track): the flag is just the time.
    expect(screen.getByText("15:10")).toBeTruthy();
    cleanup();
    const past = render(
      <DayTimeline
        meals={MEALS}
        date="2026-10-20"
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper() },
    );
    expect(past.container.querySelector("[data-part=now]")).toBeNull();
    // A past day has fully elapsed.
    expect(
      width(past.container.querySelector("[data-part=elapsed]")),
    ).toBeCloseTo(100, 6);
  });

  // A 390px phone's track measures 358px, a 360px phone's 328px.
  it.each([
    [358, "Now 15:00"],
    [328, "15:00"],
  ])(
    "keeps 12 and 18 at 15:00 on a %ipx track, flagged %s",
    (trackPx, flag) => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const clientWidth = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(trackPx);
      try {
        render(
          <DayTimeline
            meals={[]}
            date={DAY}
            today={DAY}
            now={at(15, 0)}
          />,
          { wrapper: intlWrapper() },
        );
        expect(screen.getByText(flag)).toBeTruthy();
        for (const hour of ["00", "06", "12", "18", "24"]) {
          expect(screen.getByText(hour)).toBeTruthy();
        }
      } finally {
        clientWidth.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );

  it("shows no cursor before the clock is known (server snapshot)", () => {
    const { container } = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={0}
      />,
      { wrapper: intlWrapper() },
    );
    expect(container.querySelector("[data-part=now]")).toBeNull();
  });

  it("blocks out the planned workout from the training template", () => {
    const { container } = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
        training={LOWER}
      />,
      { wrapper: intlWrapper() },
    );
    const block = container.querySelector("[data-part=workout]");
    expect(left(block)).toBeCloseTo((1080 / 1440) * 100, 6);
    expect(width(block)).toBeCloseTo((75 / 1440) * 100, 6);
  });

  it("has no workout block on a rest day or with training off", () => {
    const rest = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
        training={{ day: { type: "rest" }, dayClass: "rest" }}
      />,
      { wrapper: intlWrapper() },
    );
    expect(rest.container.querySelector("[data-part=workout]")).toBeNull();
    cleanup();
    const off = render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
      />,
      { wrapper: intlWrapper() },
    );
    expect(off.container.querySelector("[data-part=workout]")).toBeNull();
  });

  it("names the whole track for assistive tech", () => {
    render(
      <DayTimeline
        meals={MEALS}
        date={DAY}
        today={DAY}
        now={at(15, 10)}
        training={LOWER}
      />,
      { wrapper: intlWrapper() },
    );
    expect(
      screen.getByRole("img", {
        name: "Day timeline: Breakfast at 07:30, 520 kcal. Lunch at 12:45, 720 kcal. Workout, Lower · heavy day, 18:00 to 19:15. Now 15:10.",
      }),
    ).toBeTruthy();
  });
});
