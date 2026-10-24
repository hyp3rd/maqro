/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WeekdayPicker } from "./weekday-picker";

afterEach(() => cleanup());

const MON_TO_SUN = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function Harness({
  initial,
  onChange,
}: {
  initial: number[];
  onChange?: (days: number[]) => void;
}) {
  const [days, setDays] = useState<readonly number[]>(initial);
  return (
    <WeekdayPicker
      aria-label="Days of the week"
      value={days}
      onValueChange={(next) => {
        setDays(next);
        onChange?.(next);
      }}
    />
  );
}

const day = (name: string) => screen.getByRole("button", { name });

describe("WeekdayPicker", () => {
  it("is a named group of seven toggle buttons in Mon-Sun order", () => {
    render(<Harness initial={[]} />);
    const group = screen.getByRole("group", { name: "Days of the week" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(
      MON_TO_SUN,
    );
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("reads values with the JS getDay convention (0 = Sunday)", () => {
    render(<Harness initial={[0, 1]} />);
    expect(day("Sunday").getAttribute("aria-pressed")).toBe("true");
    expect(day("Monday").getAttribute("aria-pressed")).toBe("true");
    expect(day("Saturday").getAttribute("aria-pressed")).toBe("false");
  });

  it("emits getDay numbers sorted ascending when a day is toggled on", () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={[1, 5]}
        onChange={onChange}
      />,
    );
    fireEvent.click(day("Sunday"));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 5]);
    expect(day("Sunday").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(day("Wednesday"));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 3, 5]);
  });

  it("removes a day when it is toggled off", () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={[0, 1, 2, 3, 4, 5, 6]}
        onChange={onChange}
      />,
    );
    fireEvent.click(day("Saturday"));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 2, 3, 4, 5]);
    expect(day("Saturday").getAttribute("aria-pressed")).toBe("false");
  });

  it("does not mutate the value it was given", () => {
    const value = Object.freeze([2, 4]);
    const onChange = vi.fn();
    render(
      <WeekdayPicker
        aria-label="Days"
        value={value}
        onValueChange={onChange}
      />,
    );
    fireEvent.click(day("Monday"));
    expect(onChange).toHaveBeenCalledWith([1, 2, 4]);
    expect(value).toEqual([2, 4]);
  });

  it("keeps every day a native, tabbable button (Space/Enter toggle)", () => {
    render(<Harness initial={[]} />);
    for (const name of MON_TO_SUN) {
      const button = day(name);
      expect(button.getAttribute("type")).toBe("button");
      expect(button.tabIndex).toBe(0);
    }
  });

  it("gives each day a 44px target on coarse pointers", () => {
    render(<Harness initial={[]} />);
    for (const name of MON_TO_SUN) {
      expect(day(name).className).toContain("h-touch-9");
    }
  });

  it("disables every day when disabled", () => {
    const onChange = vi.fn();
    render(
      <WeekdayPicker
        aria-label="Days"
        value={[]}
        onValueChange={onChange}
        disabled
      />,
    );
    fireEvent.click(day("Monday"));
    expect(onChange).not.toHaveBeenCalled();
    expect(day("Monday").hasAttribute("disabled")).toBe(true);
  });
});
