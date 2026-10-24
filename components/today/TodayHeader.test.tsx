/**
 * @vitest-environment jsdom
 */
import { countDateFormats } from "@/lib/i18n/date-format-counter";
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TodayHeader } from "./TodayHeader";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // jsdom has no showPicker(); a case that needs one adds it.
  Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
});

function header(date: string, onSelectDate = vi.fn()) {
  return (
    <TodayHeader
      date={date}
      today="2026-10-21"
      training={undefined}
      titleId="day-title"
      onSelectDate={onSelectDate}
    />
  );
}

/** A browser that can't open its date picker (an older WebView): the
 *  header shows the date field itself once the date is tapped. */
function openFallbackField(onSelectDate = vi.fn()) {
  Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
    value: () => {
      throw new DOMException("no gesture", "NotAllowedError");
    },
    configurable: true,
  });
  const view = render(header("2026-10-21", onSelectDate), {
    wrapper: intlWrapper(),
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Wed, Oct 21, choose a day" }),
  );
  const field = screen.getByLabelText("Wed, Oct 21, choose a day");
  if (!(field instanceof HTMLInputElement)) throw new Error("no field");
  return { ...view, field, onSelectDate };
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

  describe("the date field, where the browser can't open a picker", () => {
    it("commits a typed day on blur, never the years typed on the way", () => {
      const { field, onSelectDate } = openFallbackField();
      // Typing a year digit by digit passes through valid-looking dates.
      for (const value of ["0002-10-15", "0020-10-15", "0202-10-15"])
        fireEvent.change(field, { target: { value } });
      fireEvent.change(field, { target: { value: "2026-10-15" } });
      expect(onSelectDate).not.toHaveBeenCalled();
      fireEvent.blur(field);
      expect(onSelectDate).toHaveBeenCalledTimes(1);
      expect(onSelectDate).toHaveBeenCalledWith("2026-10-15");
      // Leaving it brings the button back.
      expect(
        screen.getByRole("button", { name: "Wed, Oct 21, choose a day" })
          .tagName,
      ).toBe("BUTTON");
    });

    it("commits on Enter and returns focus to the date", () => {
      const { field, onSelectDate } = openFallbackField();
      fireEvent.change(field, { target: { value: "2026-11-02" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onSelectDate).toHaveBeenCalledTimes(1);
      expect(onSelectDate).toHaveBeenCalledWith("2026-11-02");
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Wed, Oct 21, choose a day" }),
      );
    });

    it("Escape leaves the day as it was", () => {
      const { field, onSelectDate } = openFallbackField();
      fireEvent.change(field, { target: { value: "2026-11-02" } });
      fireEvent.keyDown(field, { key: "Escape" });
      expect(onSelectDate).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Wed, Oct 21, choose a day" }),
      );
    });

    it("an unchanged or cleared field commits nothing", () => {
      const { field, onSelectDate } = openFallbackField();
      fireEvent.blur(field);
      expect(onSelectDate).not.toHaveBeenCalled();
      cleanup();
      const again = openFallbackField();
      fireEvent.change(again.field, { target: { value: "" } });
      fireEvent.blur(again.field);
      expect(again.onSelectDate).not.toHaveBeenCalled();
    });

    it("takes focus once when shown, not again on every render", () => {
      const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
      const { field, rerender, onSelectDate } = openFallbackField();
      expect(document.activeElement).toBe(field);
      expect(focus).toHaveBeenCalledTimes(1);
      fireEvent.change(field, { target: { value: "2026-10-1" } });
      rerender(header("2026-10-21", onSelectDate));
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("is a 44 px target on a touch screen", () => {
      const { field } = openFallbackField();
      expect(field.className).toContain("coarse:h-11");
      // The line grows to hold it, in answer to the user's own tap.
      expect(field.closest('[data-part="date-line"]')?.className).toContain(
        "coarse:h-11",
      );
    });
  });
});
