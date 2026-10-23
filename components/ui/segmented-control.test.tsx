/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "./segmented-control";

afterEach(() => cleanup());

type Spread = "off" | "modest" | "pronounced";
const OPTIONS = [
  { value: "off", label: "Off" },
  { value: "modest", label: "Modest" },
  { value: "pronounced", label: "Pronounced" },
] as const satisfies readonly { value: Spread; label: string }[];

function Harness({
  initial = "modest",
  onChange,
  disabled,
}: {
  initial?: Spread;
  onChange?: (v: Spread) => void;
  disabled?: Spread;
}) {
  const [value, setValue] = useState<Spread>(initial);
  return (
    <SegmentedControl
      aria-label="Day-to-day difference"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={OPTIONS.map((o) => ({ ...o, disabled: o.value === disabled }))}
    />
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("SegmentedControl", () => {
  it("is a named radiogroup of radios with exactly one checked", () => {
    render(<Harness />);
    expect(
      screen.getByRole("radiogroup", { name: "Day-to-day difference" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(radio("Modest").getAttribute("aria-checked")).toBe("true");
    expect(radio("Off").getAttribute("aria-checked")).toBe("false");
    expect(radio("Pronounced").getAttribute("aria-checked")).toBe("false");
  });

  it("puts only the checked radio in the tab order", () => {
    render(<Harness />);
    expect(radio("Modest").tabIndex).toBe(0);
    expect(radio("Off").tabIndex).toBe(-1);
    expect(radio("Pronounced").tabIndex).toBe(-1);
  });

  it("falls back to the first radio as the tab stop when nothing matches", () => {
    render(
      <SegmentedControl
        aria-label="Unit"
        value="stone"
        onValueChange={() => {}}
        options={[
          { value: "kg", label: "kg" },
          { value: "lb", label: "lb" },
        ]}
      />,
    );
    expect(radio("kg").tabIndex).toBe(0);
    expect(radio("lb").tabIndex).toBe(-1);
  });

  it("checks a radio on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(radio("Pronounced"));
    expect(onChange).toHaveBeenCalledWith("pronounced");
    expect(radio("Pronounced").getAttribute("aria-checked")).toBe("true");
  });

  it.each([
    ["ArrowRight", "Pronounced"],
    ["ArrowDown", "Pronounced"],
    ["ArrowLeft", "Off"],
    ["ArrowUp", "Off"],
  ])("%s moves focus to the adjacent radio and checks it", (key, expected) => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radio("Modest").focus();
    fireEvent.keyDown(radio("Modest"), { key });
    expect(document.activeElement).toBe(radio(expected));
    expect(radio(expected).getAttribute("aria-checked")).toBe("true");
    expect(radio(expected).tabIndex).toBe(0);
  });

  it("wraps from the last radio to the first and back", () => {
    render(<Harness initial="pronounced" />);
    fireEvent.keyDown(radio("Pronounced"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Off"));
    fireEvent.keyDown(radio("Off"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radio("Pronounced"));
  });

  it("skips disabled radios when moving with the arrows", () => {
    render(
      <Harness
        initial="off"
        disabled="modest"
      />,
    );
    fireEvent.keyDown(radio("Off"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Pronounced"));
    expect(radio("Modest").hasAttribute("disabled")).toBe(true);
  });

  it("ignores other keys", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(radio("Modest"), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sizes each segment to 44px on coarse pointers", () => {
    render(<Harness />);
    for (const r of screen.getAllByRole("radio")) {
      expect(r.className).toContain("h-touch-9");
      expect(r.getAttribute("type")).toBe("button");
    }
  });
});
