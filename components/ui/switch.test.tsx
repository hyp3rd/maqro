/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Label } from "./label";
import { Switch } from "./switch";

afterEach(() => cleanup());

function Harness({ onChange }: { onChange?: (next: boolean) => void }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <Label htmlFor="fasted">Fasted training</Label>
      <Switch
        id="fasted"
        checked={on}
        onCheckedChange={(next) => {
          setOn(next);
          onChange?.(next);
        }}
      />
    </>
  );
}

describe("Switch", () => {
  it("is a native button with the switch role, named by its label", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Fasted training" });
    expect(sw.tagName).toBe("BUTTON");
    // type=button: never submits a surrounding form.
    expect(sw.getAttribute("type")).toBe("button");
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles aria-checked on click and reports the next state", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles when its visible label is clicked", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByText("Fasted training"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is keyboard-focusable (Space/Enter activate the native button)", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch");
    sw.focus();
    expect(document.activeElement).toBe(sw);
    expect(sw.tabIndex).toBe(0);
  });

  it("does not toggle while disabled", () => {
    const onChange = vi.fn();
    render(
      <Switch
        aria-label="Reminders"
        checked
        disabled
        onCheckedChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Reminders" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets a caller's onClick veto the toggle", () => {
    const onChange = vi.fn();
    render(
      <Switch
        aria-label="Sync"
        checked={false}
        onCheckedChange={onChange}
        onClick={(e) => e.preventDefault()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Sync" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has a 44px hit area on coarse pointers", () => {
    render(
      <Switch
        aria-label="Sync"
        checked={false}
        onCheckedChange={() => {}}
      />,
    );
    const { className } = screen.getByRole("switch", { name: "Sync" });
    // 44px wide always; 28px tall on a precise pointer, 44px on a finger.
    expect(className).toContain("w-11");
    expect(className).toContain("h-touch-7");
  });
});
