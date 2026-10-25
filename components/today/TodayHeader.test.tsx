/**
 * @vitest-environment jsdom
 */
import { countDateFormats } from "@/lib/i18n/date-format-counter";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TodayHeader } from "./TodayHeader";

afterEach(() => cleanup());

function header(date: string) {
  return (
    <TodayHeader
      date={date}
      today="2026-10-21"
      training={undefined}
      titleId="day-title"
      onSelectDate={vi.fn()}
    />
  );
}

describe("TodayHeader", () => {
  it("builds its date formatters once per locale, not on every render", () => {
    let rerender: ReturnType<typeof render>["rerender"] = () => {};
    const first = countDateFormats(() => {
      rerender = render(header("2026-10-21"), {
        wrapper: intlWrapper(),
      }).rerender;
    });
    // A re-render for another day (a search keystroke re-renders too).
    const again = countDateFormats(() => rerender(header("2026-10-15")));
    expect(first).toBeLessThanOrEqual(3);
    expect(again).toBe(0);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Thursday",
    );
  });
});
