/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { WeekStrip } from "./WeekStrip";

afterEach(() => cleanup());

// Mon 19 → Sun 25 Oct 2026, each day its own (cycled) target.
const WEEK = [
  { date: "2026-10-19", targetCalories: 2300 },
  { date: "2026-10-20", targetCalories: 1950 },
  { date: "2026-10-21", targetCalories: 2500 },
  { date: "2026-10-22", targetCalories: 1950 },
  { date: "2026-10-23", targetCalories: 2300 },
  { date: "2026-10-24", targetCalories: 2400 },
  { date: "2026-10-25", targetCalories: 1950 },
];
const EATEN = new Map([
  ["2026-10-19", 2280],
  ["2026-10-20", 2060],
  ["2026-10-21", 1240],
]);

function renderStrip(
  selectedDate = "2026-10-21",
  onSelect = vi.fn(),
  {
    eaten = EATEN,
    locale = "en",
  }: { eaten?: ReadonlyMap<string, number>; locale?: "en" | "it" } = {},
) {
  render(
    <WeekStrip
      days={WEEK}
      eatenByDate={eaten}
      today="2026-10-21"
      selectedDate={selectedDate}
      onSelect={onSelect}
    />,
    { wrapper: intlWrapper(locale) },
  );
  return onSelect;
}

describe("WeekStrip", () => {
  it("is a labelled group of days, not a navigation landmark", () => {
    renderStrip();
    expect(screen.queryByRole("navigation")).toBeNull();
    const week = screen.getByRole("group", { name: "Week" });
    expect(within(week).getAllByRole("button")).toHaveLength(7);
  });

  it("names each day with its own target and intake", () => {
    renderStrip();
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Mon 19 Oct, 2,280 of 2,300 kcal",
      "Tue 20 Oct, 2,060 of 1,950 kcal, 110 above target",
      "Wed 21 Oct, today, 1,240 of 2,500 kcal so far",
      "Thu 22 Oct, target 1,950 kcal",
      "Fri 23 Oct, target 2,300 kcal",
      "Sat 24 Oct, target 2,400 kcal",
      "Sun 25 Oct, target 1,950 kcal",
    ]);
  });

  it("marks today as the current date and the shown day as pressed", () => {
    renderStrip("2026-10-20");
    const today = screen.getByRole("button", { name: /^Wed 21 Oct/ });
    expect(today.getAttribute("aria-current")).toBe("date");
    const shown = screen.getByRole("button", { name: /^Tue 20 Oct/ });
    expect(shown.getAttribute("aria-pressed")).toBe("true");
    expect(today.getAttribute("aria-pressed")).toBe("false");
  });

  it("selects a day on tap, past or future", () => {
    const onSelect = renderStrip();
    fireEvent.click(screen.getByRole("button", { name: /^Mon 19 Oct/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fri 23 Oct/ }));
    expect(onSelect.mock.calls).toEqual([["2026-10-19"], ["2026-10-23"]]);
  });

  it("shows an overshoot as a faint nub past the tick and a neutral '+N'", () => {
    renderStrip();
    const tue = screen.getByRole("button", { name: /^Tue 20 Oct/ });
    expect(tue.querySelector("[data-part=nub]")).not.toBeNull();
    const plus = screen.getByText("+110");
    expect(plus.className).toContain("text-muted-foreground");
    const mon = screen.getByRole("button", { name: /^Mon 19 Oct/ });
    expect(mon.querySelector("[data-part=nub]")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(
      /destructive|warning|success|amber|emerald|red-|rose-/,
    );
  });

  it("draws the future hollow and today in the accent", () => {
    renderStrip();
    const fri = screen.getByRole("button", { name: /^Fri 23 Oct/ });
    expect(fri.querySelector("[data-part=track]")?.className).toContain(
      "border",
    );
    const wed = screen.getByRole("button", { name: /^Wed 21 Oct/ });
    expect(wed.querySelector("[data-part=fill]")?.className).toContain(
      "bg-brand",
    );
    const mon = screen.getByRole("button", { name: /^Mon 19 Oct/ });
    expect(mon.querySelector("[data-part=fill]")?.className).toContain(
      "bg-foreground",
    );
  });

  it("builds its date formatters once, not per day on every render", () => {
    const Original = Intl.DateTimeFormat;
    let built = 0;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ) {
      built += 1;
      return new Original(...args);
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      const { rerender } = render(
        <WeekStrip
          days={WEEK}
          eatenByDate={EATEN}
          today="2026-10-21"
          selectedDate="2026-10-21"
          onSelect={vi.fn()}
        />,
        { wrapper: intlWrapper() },
      );
      const first = built;
      rerender(
        <WeekStrip
          days={WEEK}
          eatenByDate={EATEN}
          today="2026-10-21"
          selectedDate="2026-10-22"
          onSelect={vi.fn()}
        />,
      );
      // One per part (weekday, day, month) for the locale, then none.
      expect(first).toBeLessThanOrEqual(3);
      expect(built).toBe(first);
    } finally {
      spy.mockRestore();
    }
  });

  it("compacts an overshoot of 1,000 or more so it fits its cell", () => {
    // Tue: 3,250 against 1,950 → 1,300 over.
    renderStrip("2026-10-21", vi.fn(), {
      eaten: new Map([["2026-10-20", 3250]]),
    });
    const tue = screen.getByRole("button", { name: /^Tue 20 Oct/ });
    // The full figure stays in the day's name.
    expect(tue.getAttribute("aria-label")).toContain("1,300 above target");
    const plus = within(tue).getByText("+1.3K");
    // Clipped to its cell, never spilling into the next day's.
    expect(plus.className).toContain("w-[calc(100%+0.5rem)]");
    expect(plus.className).toContain("overflow-hidden");
    expect(screen.queryByText("+1,300")).toBeNull();
  });

  it("compacts in the app locale and keeps smaller overshoots whole", () => {
    renderStrip("2026-10-21", vi.fn(), {
      eaten: new Map([
        ["2026-10-19", 3600],
        ["2026-10-20", 2949],
      ]),
      locale: "it",
    });
    expect(screen.getByText("+1,3K")).toBeTruthy();
    expect(screen.getByText("+999")).toBeTruthy();
  });
});
