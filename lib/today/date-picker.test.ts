/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { openDatePicker } from "./date-picker";

function dateInput(showPicker?: () => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "date";
  // jsdom has no showPicker(); give this input one when the case needs it.
  if (showPicker)
    Object.defineProperty(input, "showPicker", { value: showPicker });
  return input;
}

describe("openDatePicker", () => {
  it("opens the platform picker when the browser has one", () => {
    const showPicker = vi.fn();
    const input = dateInput(showPicker);
    expect(openDatePicker(input)).toBe("opened");
    expect(showPicker).toHaveBeenCalledOnce();
    expect(showPicker.mock.contexts[0]).toBe(input);
  });

  it("reports a browser without showPicker() as unavailable", () => {
    expect(openDatePicker(dateInput())).toBe("unavailable");
  });

  it.each(["InvalidStateError", "NotAllowedError", "SecurityError"])(
    "reports a refusal (%s) as unavailable",
    (name) => {
      const input = dateInput(() => {
        throw new DOMException("refused", name);
      });
      expect(openDatePicker(input)).toBe("unavailable");
    },
  );

  it("rethrows anything that isn't a documented refusal", () => {
    const bug = new TypeError("not a picker");
    const input = dateInput(() => {
      throw bug;
    });
    expect(() => openDatePicker(input)).toThrow(bug);
  });
});
